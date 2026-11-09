import dotenv from "dotenv";
dotenv.config();

import { parseAbiItem, type Log, type PublicClient } from "viem";
import { verifyDatabaseConnection } from "@/backend/db/prisma";
import { closeWebSocketClient, getWebSocketClient } from "./blockchainProvider";
import { handleConditionalOrderCreated } from "./handlers/conditionalOrderCreated";
import { handleLiveTrade } from "./handlers/trade";
import { handleLiveOrderInvalidated } from "./handlers/orderInvalidated";
import { catchupHistoricalEvents } from "./startup/catchupHistoricalEvents";
import { backfillOrderUids } from "./startup/backfillOrderUids";
import { startMarketSync, stopMarketSync } from "./cron/marketSync";
import { createLogger, getActiveLogLevel } from "@/backend/logger";

const log = createLogger("listener");
import {
  startPositionSeller,
  stopPositionSeller,
  subscribePositionReceipts,
  triggerPositionSell,
} from "./cron/positionSeller";
import { startDraftJanitor, stopDraftJanitor } from "./cron/draftJanitor";
import { startOrderHealthCheck, stopOrderHealthCheck } from "./cron/orderHealthCheck";
import { startWebSocketSupervisor, stopWebSocketSupervisor } from "./webSocketSupervisor";
import { readPositiveInt, requireAddress } from "@/backend/utils/env";

// Canonical event signatures used by `watchEvent`. Using `parseAbiItem` keeps
// the resulting `AbiEvent` value strongly typed (no cast required) and
// avoids the `getAbiItem` overload that returns `AbiEvent | undefined`.
const CONDITIONAL_ORDER_CREATED_EVENT = parseAbiItem(
  "event ConditionalOrderCreated(address indexed owner, (address handler, bytes32 salt, bytes staticInput) params)"
);
const TRADE_EVENT = parseAbiItem(
  "event Trade(address indexed owner, address sellToken, address buyToken, uint256 sellAmount, uint256 buyAmount, uint256 feeAmount, bytes orderUid)"
);
const ORDER_INVALIDATED_EVENT = parseAbiItem(
  "event OrderInvalidated(address indexed owner, bytes orderUid)"
);

interface RuntimeFlags {
  listenerOnly: boolean;
  marketUpdateOnly: boolean;
}

function readArgs(): RuntimeFlags {
  const argv = new Set(process.argv.slice(2));
  const listenerOnly = argv.has("--listener-only") || argv.has("-l");
  const marketUpdateOnly = argv.has("--market-update-only") || argv.has("-u");

  if (listenerOnly && marketUpdateOnly) {
    log.error("Cannot use both --market-update-only and --listener-only flags");
    process.exit(1);
  }

  return { listenerOnly, marketUpdateOnly };
}

function requireEnv(names: readonly string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`listener: missing required env vars: ${missing.join(", ")}`);
  }
}

const LISTENER_ENV: readonly string[] = [
  "WSS_RPC_URL",
  "RPC_URL",
  "COMPOSABLE_COW",
  "GPV2SETTLEMENT",
  "NEXT_PUBLIC_POLYSWAP_HANDLER",
];

const ORDER_PLACEMENT_ENV: readonly string[] = [
  "PK",
  "CLOB_API_KEY",
  "CLOB_SECRET",
  "CLOB_PASS_PHRASE",
];

const MARKET_UPDATE_INTERVAL_MIN = readPositiveInt("MARKET_UPDATE_INTERVAL_MINUTES", 60);
const POSITION_SELL_INTERVAL_MIN = readPositiveInt("POSITION_SELL_INTERVAL_MINUTES", 10);
const DRAFT_JANITOR_INTERVAL_SEC = readPositiveInt("DRAFT_JANITOR_INTERVAL_SECONDS", 60);
const ORDER_HEALTH_CHECK_INTERVAL_SEC = readPositiveInt("ORDER_HEALTH_CHECK_INTERVAL_SECONDS", 60);

function subscribeOrderEvents(
  ws: PublicClient,
  options: { allowTrading: boolean },
  onError: (error: Error) => void
): Array<() => void> {
  const composableCow = requireAddress("COMPOSABLE_COW");
  const gpv2 = requireAddress("GPV2SETTLEMENT");

  return [
    ws.watchEvent({
      address: composableCow,
      event: CONDITIONAL_ORDER_CREATED_EVENT,
      onError,
      onLogs: (logs) => {
        for (const log of logs) {
          void handleConditionalOrderCreated(log as Log, options);
        }
      },
    }),
    ws.watchEvent({
      address: gpv2,
      event: TRADE_EVENT,
      onError,
      onLogs: (logs) => {
        for (const log of logs) {
          void handleLiveTrade(log as Log, triggerPositionSell);
        }
      },
    }),
    ws.watchEvent({
      address: gpv2,
      event: ORDER_INVALIDATED_EVENT,
      onError,
      onLogs: (logs) => {
        for (const log of logs) {
          void handleLiveOrderInvalidated(log as Log);
        }
      },
    }),
  ];
}

async function main(): Promise<void> {
  // Next.js loads this automatically for server requests. The listener runs as
  // a standalone tsx process, so it must initialize the same server client.
  // Mark it first so recurrent successful work is excluded from Sentry traces.
  process.env.POLYSWAP_SENTRY_RUNTIME = "listener";
  await import("../../../sentry.server.config");

  const flags = readArgs();

  if (!flags.marketUpdateOnly) {
    requireEnv(LISTENER_ENV);
  }
  if (!flags.listenerOnly && !flags.marketUpdateOnly) {
    requireEnv(ORDER_PLACEMENT_ENV);
  }

  const eventOptions = { allowTrading: !flags.listenerOnly };

  await verifyDatabaseConnection();
  log.info(`log level ${getActiveLogLevel()}`);
  log.info("database connection verified");

  if (!flags.marketUpdateOnly) {
    log.info("starting (catch-up + WebSocket subscriptions)");
    await catchupHistoricalEvents(eventOptions);
    await backfillOrderUids();
  }

  if (!flags.listenerOnly && !flags.marketUpdateOnly) {
    log.info(`starting position-seller cron every ${POSITION_SELL_INTERVAL_MIN}min`);
    await startPositionSeller(POSITION_SELL_INTERVAL_MIN);

    log.info(`starting draft-janitor cron every ${DRAFT_JANITOR_INTERVAL_SEC}s`);
    startDraftJanitor(DRAFT_JANITOR_INTERVAL_SEC);

    log.info(`starting order-health-check cron every ${ORDER_HEALTH_CHECK_INTERVAL_SEC}s`);
    startOrderHealthCheck(ORDER_HEALTH_CHECK_INTERVAL_SEC);
  }

  if (!flags.marketUpdateOnly) {
    const trading = !flags.listenerOnly;
    startWebSocketSupervisor({
      connect: getWebSocketClient,
      disconnect: closeWebSocketClient,
      subscribe: (ws, onError) => [
        ...subscribeOrderEvents(ws, eventOptions, onError),
        ...(trading ? subscribePositionReceipts(ws, onError) : []),
      ],
      recover: async () => {
        if (trading) void triggerPositionSell();
        await catchupHistoricalEvents(eventOptions);
      },
    });
  }

  if (!flags.listenerOnly) {
    log.info(`starting market-sync cron every ${MARKET_UPDATE_INTERVAL_MIN}min`);
    startMarketSync(MARKET_UPDATE_INTERVAL_MIN);
  }

  const shutdown = (signal: string): void => {
    log.info(`received ${signal}, shutting down`);
    stopWebSocketSupervisor();
    if (!flags.listenerOnly) stopMarketSync();
    if (!flags.listenerOnly && !flags.marketUpdateOnly) {
      stopPositionSeller();
      stopDraftJanitor();
      stopOrderHealthCheck();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const ready = flags.marketUpdateOnly
    ? "market-update only"
    : flags.listenerOnly
      ? "listener only"
      : "all services";
  log.info(`ready (${ready}). Press Ctrl+C to stop.`);

  if (flags.marketUpdateOnly) {
    // Keep the process alive when only the market-sync cron is running.
    process.stdin.resume();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error("fatal:", err);
    process.exit(1);
  });
}
