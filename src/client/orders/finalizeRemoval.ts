import { notifyRemoveOrder } from "@/client/api/polyswapApi";

/** "pending": remove() executed but the server has not recorded it; the listener will within a minute. */
export type RemovalOutcome = "canceled" | "pending";

interface FinalizeRemovalOptions {
  notify?: (orderId: number) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Records an executed ComposableCoW.remove() server-side. The server's node can lag
 * the block that removed the order, so failures are retried. It never throws: the
 * removal already happened on-chain.
 */
export async function finalizeRemoval(
  orderId: number,
  {
    notify = notifyRemoveOrder,
    wait = sleep,
    attempts = 4,
    retryDelayMs = 2_000,
  }: FinalizeRemovalOptions = {}
): Promise<RemovalOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      await notify(orderId);
      return "canceled";
    } catch {
      if (attempt >= attempts) return "pending";
      await wait(retryDelayMs);
    }
  }
}
