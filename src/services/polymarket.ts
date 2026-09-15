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
  if (json === null || typeof json !== "object") {
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

/**
 * Real trade history for a single CLOB token, as Polymarket's web charts use.
 * `interval=max` is the only one that consistently returns data; we slice
 * client-side to whatever window the caller wants.
 */
export async function fetchClobPriceHistory(tokenId: string): Promise<ClobHistoryPoint[]> {
  if (!tokenId) return [];
  const url = `${CLOB_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=max`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CLOB /prices-history failed: ${res.status}`);
  const json: unknown = await res.json();
  if (
    json === null ||
    typeof json !== "object" ||
    !Array.isArray((json as { history?: unknown }).history)
  ) {
    return [];
  }
  return (json as { history: ClobHistoryPoint[] }).history;
}

/**
 * Convenience: fetch BUY+SELL for every token, return the midpoint as a number
 * in [0, 1]. Tokens with no price come back missing from the map.
 */
export async function fetchClobMidpoints(tokenIds: string[]): Promise<Map<string, number>> {
  if (tokenIds.length === 0) return new Map();
  const requests: ClobPriceRequest[] = tokenIds.flatMap((token_id) => [
    { token_id, side: "BUY" as ClobSide },
    { token_id, side: "SELL" as ClobSide },
  ]);
  const prices = await fetchClobPrices(requests);
  const out = new Map<string, number>();
  for (const tokenId of tokenIds) {
    const sides = prices[tokenId];
    if (!sides) continue;
    const buy = Number(sides.BUY);
    const sell = Number(sides.SELL);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) continue;
    out.set(tokenId, (buy + sell) / 2);
  }
  return out;
}
