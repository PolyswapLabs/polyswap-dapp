import { createLogger } from "@/backend/logger";
import { readPositiveInt } from "@/backend/utils/env";

const log = createLogger("listener");

export type Mode = "all" | "listener" | "markets";

export interface Intervals {
  marketUpdateMinutes: number;
  positionSellMinutes: number;
  draftJanitorSeconds: number;
  orderHealthCheckSeconds: number;
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

export function readMode(): Mode {
  const argv = new Set(process.argv.slice(2));
  const listenerOnly = argv.has("--listener-only") || argv.has("-l");
  const marketUpdateOnly = argv.has("--market-update-only") || argv.has("-u");

  if (listenerOnly && marketUpdateOnly) {
    log.error("Cannot use both --market-update-only and --listener-only flags");
    process.exit(1);
  }

  if (listenerOnly) return "listener";
  return marketUpdateOnly ? "markets" : "all";
}

function requireEnv(names: readonly string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`listener: missing required env vars: ${missing.join(", ")}`);
  }
}

export function assertRequiredEnv(mode: Mode): void {
  if (mode !== "markets") requireEnv(LISTENER_ENV);
  if (mode === "all") requireEnv(ORDER_PLACEMENT_ENV);
}

export function readIntervals(): Intervals {
  return {
    marketUpdateMinutes: readPositiveInt("MARKET_UPDATE_INTERVAL_MINUTES", 60),
    positionSellMinutes: readPositiveInt("POSITION_SELL_INTERVAL_MINUTES", 10),
    draftJanitorSeconds: readPositiveInt("DRAFT_JANITOR_INTERVAL_SECONDS", 60),
    orderHealthCheckSeconds: readPositiveInt("ORDER_HEALTH_CHECK_INTERVAL_SECONDS", 60),
  };
}
