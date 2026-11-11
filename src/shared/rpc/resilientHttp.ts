import {
  http,
  HttpRequestError,
  TimeoutError,
  LimitExceededRpcError,
  ResourceUnavailableRpcError,
  type HttpTransportConfig,
  type Transport,
} from "viem";

/**
 * Drop-in replacement for viem's `http()` transport that retries failed
 * requests with exponential backoff + jitter.
 *
 * Defaults retry on: HTTP 408/425/429/5xx, viem `TimeoutError`,
 * JSON-RPC `LimitExceededRpcError`, `ResourceUnavailableRpcError`, and
 * common transient network failures (ECONNRESET, fetch failed, ...).
 *
 * Non-retryable errors (bad params, user rejection, encoding issues, etc.)
 * are surfaced immediately on the first failure.
 */
interface ResilientHttpConfig extends HttpTransportConfig {
  /** Total attempts including the first call. Default 5. */
  maxAttempts?: number;
  /** Initial backoff delay in ms; doubles per attempt. Default 250. */
  baseDelayMs?: number;
  /** Cap on a single backoff delay. Default 8_000. */
  maxDelayMs?: number;
  /** Predicate to override the default retryable-error matcher. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry — useful for logging. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8_000;

export function resilientHttp(url?: string, config: ResilientHttpConfig = {}): Transport {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    shouldRetry = isRetryableRpcError,
    onRetry = defaultOnRetry,
    ...httpConfig
  } = config;

  // Disable viem's built-in linear retry — we own retry semantics here.
  const inner = http(url, { ...httpConfig, retryCount: 0 });

  return ((params) => {
    const transport = inner(params);
    const baseRequest = transport.request;

    const request: typeof baseRequest = async (args, options) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await baseRequest(args, options);
        } catch (error) {
          lastError = error;
          if (attempt === maxAttempts || !shouldRetry(error)) throw error;
          const delayMs = computeBackoff(attempt, baseDelayMs, maxDelayMs);
          onRetry({ attempt, delayMs, error });
          await sleep(delayMs);
        }
      }
      throw lastError;
    };

    return { ...transport, request };
  }) as Transport;
}

function computeBackoff(attempt: number, base: number, max: number): number {
  const exp = Math.min(base * 2 ** (attempt - 1), max);
  // Full jitter: random in [exp/2, exp] — smooths thundering-herd retries.
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const RETRYABLE_NETWORK_PATTERNS = [
  "fetch failed",
  "network request failed",
  "socket hang up",
  "econnreset",
  "econnrefused",
  "etimedout",
  "enotfound",
  "eai_again",
];

function isRetryableRpcError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (error instanceof TimeoutError) return true;
  if (error instanceof LimitExceededRpcError) return true;
  if (error instanceof ResourceUnavailableRpcError) return true;

  if (error instanceof HttpRequestError && error.status !== undefined) {
    return RETRYABLE_HTTP_STATUSES.has(error.status);
  }

  // Wrapped fetch / DNS / TCP failures bubble up as plain Error from viem.
  const message = error.message.toLowerCase();
  return RETRYABLE_NETWORK_PATTERNS.some((needle) => message.includes(needle));
}

function defaultOnRetry({
  attempt,
  delayMs,
  error,
}: {
  attempt: number;
  delayMs: number;
  error: unknown;
}) {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`[rpc] attempt ${attempt} failed, retrying in ${delayMs}ms: ${reason}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
