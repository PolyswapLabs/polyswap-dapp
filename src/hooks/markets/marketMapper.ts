import { getDisplayAssetIds, type ProtocolVersion } from "@/shared/polymarket/protocol";
import {
  getClobPrice,
  type ClobPriceRequest,
  type ClobPricesResponse,
} from "@/shared/polymarket/clob";
import { MARKET_CATEGORIES, type MarketCategory } from "@/shared/markets/categories";
import { type MarketViewModel } from "@/types/viewModels";
import type { RecommendationMarketRow } from "@/shared/markets/recommendationPolicy";

export interface PricedMarket {
  id: string;
  title: string;
  volume: number;
  endDate: string;
  category: string;
  /** Live midpoint for the YES token, as a 0..100 percentage. */
  yesOdds: number;
  /** Lowest live ask for the YES token, as a 0..100 percentage. */
  yesBestAsk?: number;
  /** Lowest live ask for the NO token, as a 0..100 percentage. */
  noBestAsk?: number;
  yesTokenId?: string;
  noTokenId?: string;
  slug: string;
  eventSlug?: string;
  clobTokenIds: string[];
  protocolVersion: ProtocolVersion | null;
}

const CANONICAL_BY_LOWER: ReadonlyMap<string, MarketCategory> = new Map(
  MARKET_CATEGORIES.map((c) => [c.toLowerCase(), c])
);

function normalizeCategory(raw: string): MarketCategory | null {
  return CANONICAL_BY_LOWER.get(raw.trim().toLowerCase()) ?? null;
}

function midpointPercent(prices: ClobPricesResponse, tokenId: string | undefined): number {
  if (!tokenId) return 0;
  const sides = prices[tokenId];
  if (!sides) return 0;
  const buy = Number(sides.BUY);
  const sell = Number(sides.SELL);
  if (!Number.isFinite(buy) || !Number.isFinite(sell)) return 0;
  return Number((((buy + sell) / 2) * 100).toFixed(2));
}

function bestAskPercent(
  prices: ClobPricesResponse,
  tokenId: string | undefined
): number | undefined {
  const ask = getClobPrice(prices, tokenId, "SELL");
  return ask === null ? undefined : ask * 100;
}

function displayTokenIds(row: RecommendationMarketRow): string[] {
  return getDisplayAssetIds({
    protocolVersion: row.protocol_version,
    clobTokenIds: row.clob_token_ids,
    positionIds: row.position_ids,
    outcomes: row.outcomes,
  });
}

/** Two-outcome markets not labelled Yes/No read their first outcome as YES. */
function yesNoIndexes(outcomes: string[]): [number, number] {
  const yesIdx = outcomes.indexOf("Yes");
  const noIdx = outcomes.indexOf("No");
  return yesIdx >= 0 && noIdx >= 0 ? [yesIdx, noIdx] : [0, 1];
}

/** Returns null for anything but a two-outcome market: the UI only trades those. */
export function toPricedMarket(
  row: RecommendationMarketRow,
  prices: ClobPricesResponse
): PricedMarket | null {
  if (row.outcomes.length !== 2) return null;

  const tokenIds = displayTokenIds(row);
  const [yesIdx, noIdx] = yesNoIndexes(row.outcomes);
  const yesTokenId = tokenIds[yesIdx];
  const noTokenId = tokenIds[noIdx];

  return {
    id: row.id,
    title: row.question,
    // Postgres NUMERIC arrives as string over JSON — coerce up-front so
    // downstream formatters (formatUsd) don't fall back to the em-dash placeholder.
    volume: Number(row.volume) || 0,
    endDate: row.end_date ?? "",
    category: row.category ?? "",
    yesOdds: midpointPercent(prices, yesTokenId),
    yesBestAsk: bestAskPercent(prices, yesTokenId),
    noBestAsk: bestAskPercent(prices, noTokenId),
    yesTokenId,
    noTokenId,
    slug: row.slug,
    eventSlug: row.event_slug ?? undefined,
    clobTokenIds: row.clob_token_ids,
    protocolVersion: row.protocol_version,
  };
}

export function toMarketViewModel(market: PricedMarket | null): MarketViewModel | null {
  if (!market) return null;
  const category = normalizeCategory(market.category);
  if (!category) return null;
  return {
    id: market.id,
    slug: market.slug,
    eventSlug: market.eventSlug ?? null,
    yesTokenId: market.yesTokenId ?? null,
    noTokenId: market.noTokenId ?? null,
    category,
    question: market.title,
    yesProbability: market.yesOdds / 100,
    yesBestAsk: market.yesBestAsk === undefined ? null : market.yesBestAsk / 100,
    noBestAsk: market.noBestAsk === undefined ? null : market.noBestAsk / 100,
    volume24h: null,
    volumeTotal: market.volume,
    endsAt: market.endDate,
  };
}

export function isMarketViewModel(market: MarketViewModel | null): market is MarketViewModel {
  return market !== null;
}

export function tokenPriceRequests(rows: RecommendationMarketRow[]): ClobPriceRequest[] {
  return rows.flatMap(displayTokenIds).flatMap((tokenId): ClobPriceRequest[] => [
    { token_id: tokenId, side: "BUY" },
    { token_id: tokenId, side: "SELL" },
  ]);
}
