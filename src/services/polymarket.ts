import { isRecord } from "./api";

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

/**
 * Real trade history for a single CLOB token, as Polymarket's web charts use.
 * `interval=max` is the only one that consistently returns data; we slice
 * client-side to whatever window the caller wants.
 */
export async function fetchClobPriceHistory(tokenId: string): Promise<ClobHistoryPoint[]> {
  if (!tokenId) return [];
  return withHistorySlot(() => fetchHistory(tokenId));
}

async function fetchHistory(tokenId: string): Promise<ClobHistoryPoint[]> {
  const url = `${CLOB_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=max`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`CLOB /prices-history failed: ${res.status}`);
  const json: unknown = await res.json();
  if (!isRecord(json) || !Array.isArray(json.history)) return [];
  return json.history as ClobHistoryPoint[];
}
