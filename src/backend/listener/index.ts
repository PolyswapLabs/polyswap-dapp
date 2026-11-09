import dotenv from "dotenv";
import { verifyDatabaseConnection } from "@/backend/db/prisma";
import { assertRequiredEnv, readIntervals, readMode, type Mode } from "@/backend/listener/config";
import { buildServices } from "@/backend/listener/services";
import { backfillOrderUids } from "@/backend/listener/startup/backfillOrderUids";
import { catchupHistoricalEvents } from "@/backend/listener/startup/catchupHistoricalEvents";
import { createLogger, getActiveLogLevel } from "@/backend/logger";

dotenv.config();

const log = createLogger("listener");

const READY_LABEL: Record<Mode, string> = {
  all: "all services",
  listener: "listener only",
  markets: "market-update only",
};

async function main(): Promise<void> {
  // Next.js loads this automatically for server requests. The listener runs as
  // a standalone tsx process, so it must initialize the same server client.
  // Mark it first so recurrent successful work is excluded from Sentry traces.
  process.env.POLYSWAP_SENTRY_RUNTIME = "listener";
  await import("../../../sentry.server.config");

  const mode = readMode();
  assertRequiredEnv(mode);
  const eventOptions = { allowTrading: mode === "all" };

  await verifyDatabaseConnection();
  log.info(`log level ${getActiveLogLevel()}`);
  log.info("database connection verified");

  if (mode !== "markets") {
    log.info("starting (catch-up + WebSocket subscriptions)");
    await catchupHistoricalEvents(eventOptions);
    await backfillOrderUids();
  }

  const services = buildServices(mode, readIntervals(), eventOptions);
  for (const service of services) await service.start();

  const shutdown = (signal: string): void => {
    log.info(`received ${signal}, shutting down`);
    for (const service of services.toReversed()) service.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log.info(`ready (${READY_LABEL[mode]}). Press Ctrl+C to stop.`);

  // Keep the process alive when only the market-sync cron is running.
  if (mode === "markets") process.stdin.resume();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error("fatal:", err);
    process.exit(1);
  });
}
