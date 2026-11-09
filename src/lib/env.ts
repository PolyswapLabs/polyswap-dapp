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
