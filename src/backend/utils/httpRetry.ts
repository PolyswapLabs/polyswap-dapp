/** Resolve Retry-After to an absolute timestamp with a minimum fallback delay. */
export function getRetryAt(
  retryAfter: string | null,
  now: number,
  fallbackDelayMs: number
): number {
  const fallbackAt = now + fallbackDelayMs;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(fallbackAt, now + seconds * 1_000);
    }

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(fallbackAt, date);
  }

  return fallbackAt;
}

export function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
