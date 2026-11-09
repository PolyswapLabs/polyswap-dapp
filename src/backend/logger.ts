/**
 * Leveled logger for the listener and the services it calls.
 *
 * Configured by the LOG_LEVEL env var, similar to RUST_LOG. Default is `info`.
 * Available levels, in increasing verbosity:
 *
 *   error  — failures the operator must see
 *   warn   — recoverable anomalies
 *   info   — high-level lifecycle events (boot, cron ticks summaries)
 *   debug  — per-iteration / per-event detail useful when investigating
 *
 * Format:
 *   2026-05-08T10:42:00.123Z INFO  market-sync upserted 142 markets
 *
 * Usage:
 *   const log = createLogger("market-sync");
 *   log.info("upserted %d markets", count);   // printf-style via console.log
 *   log.debug({ markets }, "fetched payload"); // structured, opt-in
 */

type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "ERROR",
  warn: "WARN ",
  info: "INFO ",
  debug: "DEBUG",
};

function readLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").trim().toLowerCase();
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug") {
    return raw;
  }
  // Stay out of the way: fall back to `info` and emit one-line notice.
  console.warn(`logger: invalid LOG_LEVEL=${JSON.stringify(raw)}, defaulting to "info"`);
  return "info";
}

const activeLevel: LogLevel = readLevel();
const activeThreshold = LEVEL_PRIORITY[activeLevel];

interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVEL_PRIORITY[level] > activeThreshold) return;
  const prefix = `${new Date().toISOString()} ${LEVEL_LABEL[level]} ${scope}`;
  // Route to the matching console method so devtools / log shippers
  // see the right severity. Errors go to stderr; rest to stdout.
  if (level === "error") console.error(prefix, ...args);
  else if (level === "warn") console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

export function createLogger(scope: string): Logger {
  scope = `[${scope}]`;
  return {
    error: (...args) => emit("error", scope, args),
    warn: (...args) => emit("warn", scope, args),
    info: (...args) => emit("info", scope, args),
    debug: (...args) => emit("debug", scope, args),
  };
}

/** Active level resolved at module load. Exposed for diagnostics. */
export function getActiveLogLevel(): LogLevel {
  return activeLevel;
}
