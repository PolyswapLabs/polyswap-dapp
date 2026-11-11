interface Waiter<V> {
  resolve: (value: V | undefined) => void;
  reject: (reason: unknown) => void;
}

export interface RequestBatcherOptions<V> {
  /** One bulk request for a set of distinct keys. Keys missing from the map resolve to `undefined`. */
  loadMany: (keys: string[]) => Promise<ReadonlyMap<string, V>>;
  /** Hard cap per bulk request; a full queue flushes immediately. */
  maxBatchSize: number;
  /** How long to wait for sibling requests before flushing. */
  windowMs?: number;
}

/**
 * Coalesces single-key loads issued within `windowMs` into bulk requests, so
 * N sibling components (e.g. one per list row) asking for N keys cost
 * ceil(N / maxBatchSize) round trips instead of N. Duplicate keys share a slot.
 */
export function createRequestBatcher<V>({
  loadMany,
  maxBatchSize,
  windowMs = 10,
}: RequestBatcherOptions<V>): (key: string) => Promise<V | undefined> {
  let queue = new Map<string, Waiter<V>[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const batch = queue;
    queue = new Map();
    if (batch.size === 0) return;

    loadMany([...batch.keys()]).then(
      (values) => {
        for (const [key, waiters] of batch) {
          const value = values.get(key);
          for (const w of waiters) w.resolve(value);
        }
      },
      (error: unknown) => {
        for (const waiters of batch.values()) for (const w of waiters) w.reject(error);
      }
    );
  };

  return (key) =>
    new Promise<V | undefined>((resolve, reject) => {
      const waiters = queue.get(key);
      if (waiters) waiters.push({ resolve, reject });
      else queue.set(key, [{ resolve, reject }]);

      if (queue.size >= maxBatchSize) flush();
      else if (timer === null) timer = setTimeout(flush, windowMs);
    });
}
