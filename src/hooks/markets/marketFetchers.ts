import {
  fetchClobPriceHistory,
  fetchClobPrices,
  type ClobHistoryPoint,
} from "@/services/polymarket";
import { apiService, isSuccessEnvelope, readApiResponse } from "@/services/api";
import type { MarketCategory, MarketViewModel } from "@/types/design";
import type {
  DatabaseRecommendationMarket,
  OddsRange,
  RecommendationPage,
} from "@/lib/marketRecommendations";
import {
  isMarketViewModel,
  toMarketViewModel,
  toPricedMarket,
  tokenPriceRequests,
  type PricedMarket,
} from "./marketMapper";

const SUGGESTION_LIMIT = 8;
const SECONDS_PER_DAY = 86_400;

interface MarketSearchParams {
  sort?: string;
  limit?: number;
  offset?: number;
  q?: string;
  category?: string;
  categories?: ReadonlyArray<string>;
}

interface MarketSearchPayload {
  markets: DatabaseRecommendationMarket[];
  count: number;
  total: number;
}

interface PricedMarketPage {
  items: (PricedMarket | null)[];
  total: number;
}

export interface RecommendedMarketsQuery extends OddsRange {
  page: number;
  pageSize: number;
  category: MarketCategory | null;
}

export interface TagSuggestion {
  tag: string;
  count: number;
}

function marketSearchUrl(params: MarketSearchParams): string {
  const url = new URL("/api/markets/search", window.location.origin);
  if (params.sort) url.searchParams.set("sort", params.sort);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) url.searchParams.set("offset", String(params.offset));
  if (params.q) url.searchParams.set("q", params.q);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.categories && params.categories.length > 0) {
    url.searchParams.set("categories", params.categories.join(","));
  }
  return url.toString();
}

export async function searchPricedMarkets(params: MarketSearchParams): Promise<PricedMarketPage> {
  const res = await fetch(marketSearchUrl(params));
  const { data } = await readApiResponse(res, isSuccessEnvelope<MarketSearchPayload>);
  const total = data.total ?? 0;
  if (data.markets.length === 0) return { items: [], total };

  const prices = await fetchClobPrices(tokenPriceRequests(data.markets));
  return { items: data.markets.map((row) => toPricedMarket(row, prices)), total };
}

export async function fetchPricedMarket(
  slug: string,
  opts: { track?: boolean } = {}
): Promise<PricedMarket | null> {
  const market = await apiService.getMarketBySlug(slug, opts);
  if (!market) return null;
  const row: DatabaseRecommendationMarket = {
    ...market,
    // Typed as Date, but the API response delivers an ISO string at runtime.
    end_date: market.end_date instanceof Date ? market.end_date.toISOString() : market.end_date,
  };
  const prices = await fetchClobPrices(tokenPriceRequests([row]));
  return toPricedMarket(row, prices);
}

async function pricedViewModels(rows: DatabaseRecommendationMarket[]): Promise<MarketViewModel[]> {
  const prices = rows.length ? await fetchClobPrices(tokenPriceRequests(rows)) : {};
  return rows
    .map((row) => toMarketViewModel(toPricedMarket(row, prices)))
    .filter(isMarketViewModel);
}

export async function fetchRecommendedMarkets({
  page,
  pageSize,
  category,
  oddsMin,
  oddsMax,
}: RecommendedMarketsQuery) {
  const params = new URLSearchParams({
    oddsMin: String(oddsMin),
    oddsMax: String(oddsMax),
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (category) params.set("category", category);
  const res = await fetch(`/api/markets/recommended?${params}`);
  const { data } = await readApiResponse(res, isSuccessEnvelope<RecommendationPage>);
  if (data.source === "database") {
    return { ...data, items: await pricedViewModels(data.markets) };
  }
  return {
    ...data,
    items: data.markets.map(
      (market): MarketViewModel => ({ ...market, yesBestAsk: null, noBestAsk: null })
    ),
  };
}

/** Clips to the most recent `days`, or keeps the full series if that leaves under two points. */
export async function fetchRecentPriceHistory(
  tokenId: string | null | undefined,
  days: number
): Promise<ClobHistoryPoint[]> {
  if (!tokenId) return [];
  const all = await fetchClobPriceHistory(tokenId);
  if (days <= 0 || all.length === 0) return all;
  const cutoff = Math.floor(Date.now() / 1000) - days * SECONDS_PER_DAY;
  const recent = all.filter((point) => point.t >= cutoff);
  return recent.length >= 2 ? recent : all;
}

export async function fetchTagSuggestions(prefix: string): Promise<TagSuggestion[]> {
  if (prefix.length === 0) return [];
  const url = new URL("/api/markets/suggest", window.location.origin);
  url.searchParams.set("q", prefix);
  url.searchParams.set("limit", String(SUGGESTION_LIMIT));
  const res = await fetch(url.toString());
  return (await readApiResponse(res, isSuccessEnvelope<TagSuggestion[]>)).data;
}
