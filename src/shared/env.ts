export const SENTRY_DSN =
  "https://d190690c303492020ebc0c241b5bd560@o4510743731175424.ingest.de.sentry.io/4510743738974288";

/**
 * Resolves the runtime environment from the `ENVIRONMENT` env var.
 *
 *   prod | production  → production
 *   dev  | local        → development (default)
 *
 * Mirrored into the client bundle via `next.config.ts` `env`.
 */
export function isProductionEnvironment(): boolean {
  const raw = (process.env.ENVIRONMENT ?? "").trim().toLowerCase();
  return raw === "prod" || raw === "production";
}

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function isOrderCreationDisabled(): boolean {
  return isEnabled(process.env.ORDER_CREATION_DISABLED);
}

export function isDappMaintenanceMode(): boolean {
  return isEnabled(process.env.DAPP_MAINTENANCE);
}

/** Post-only is the safe default and can only be disabled explicitly. */
export function isPolymarketSentinelPostOnly(): boolean {
  const value = process.env.POLYMARKET_SENTINEL_POST_ONLY?.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value ?? "");
}
