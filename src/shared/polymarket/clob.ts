import { isRecord } from "@/shared/guards";
import { createRequestBatcher } from "@/shared/requestBatcher";

const CLOB_BASE = "https://clob.polymarket.com";

export type ClobSide = "BUY" | "SELL";

export interface ClobPriceRequest {
  token_id: string;
  side: ClobSide;
}

export type ClobPricesResponse = Record<string, Partial<Record<ClobSide, string>>>;

export async function fetchClobPrices(requests: ClobPriceRequest[]): Promise<ClobPricesResponse> {
  if (requests.length === 0) return {};
  const res = await fetch(`${CLOB_BASE}/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requests),
  });
  if (!res.ok) throw new Error(`CLOB /prices failed: ${res.status}`);
  const json: unknown = await res.json();
  if (!isRecord(json)) {
    throw new Error("CLOB /prices returned non-object response");
  }
  return json as ClobPricesResponse;
}

export function getClobPrice(
  prices: ClobPricesResponse,
  tokenId: string | null | undefined,
  side: ClobSide
): number | null {
  if (!tokenId) return null;
  const price = Number(prices[tokenId]?.[side]);
  return Number.isFinite(price) && price > 0 && price <= 1 ? price : null;
}

/** A BUY crosses against the SELL side, so SELL is the relevant live best ask. */
export async function fetchClobBestAsk(tokenId: string): Promise<number | null> {
  const prices = await fetchClobPrices([{ token_id: tokenId, side: "SELL" }]);
  return getClobPrice(prices, tokenId, "SELL");
}

export interface ClobHistoryPoint {
  /** Unix seconds. */
  t: number;
  /** Price in [0, 1]. */
  p: number;
}

let activeHistoryRequests = 0;
const historyWaiters: Array<() => void> = [];

async function withHistorySlot<T>(request: () => Promise<T>): Promise<T> {
  if (activeHistoryRequests >= 4) {
    await new Promise<void>((resolve) => historyWaiters.push(resolve));
  } else activeHistoryRequests += 1;
  try {
    return await request();
  } finally {
    const next = historyWaiters.shift();
    if (next) {
      // Transfer the occupied slot directly to the next waiter.
      next();
    } else activeHistoryRequests -= 1;
  }
}

/** CLOB rejects `/batch-prices-history` bodies with more than 20 markets. */
const HISTORY_BATCH_LIMIT = 20;

/**
 * Real trade history for a single CLOB token, as Polymarket's web charts use.
 * `interval=max` is the only one that consistently returns data; we slice
 * client-side to whatever window the caller wants. Calls made in the same
 * tick (one per list row) share a single batch request.
 */
export async function fetchClobPriceHistory(tokenId: string): Promise<ClobHistoryPoint[]> {
  if (!tokenId) return [];
  return (await loadHistory(tokenId)) ?? [];
}

const loadHistory = createRequestBatcher<ClobHistoryPoint[]>({
  loadMany: (tokenIds) => withHistorySlot(() => fetchHistories(tokenIds)),
  maxBatchSize: HISTORY_BATCH_LIMIT,
});

async function fetchHistories(tokenIds: string[]): Promise<Map<string, ClobHistoryPoint[]>> {
  const res = await fetch(`${CLOB_BASE}/batch-prices-history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markets: tokenIds, interval: "max" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`CLOB /batch-prices-history failed: ${res.status}`);
  const json: unknown = await res.json();
  const histories = new Map<string, ClobHistoryPoint[]>();
  if (!isRecord(json) || !isRecord(json.history)) return histories;
  for (const [tokenId, points] of Object.entries(json.history)) {
    if (Array.isArray(points)) histories.set(tokenId, points as ClobHistoryPoint[]);
  }
  return histories;
}
