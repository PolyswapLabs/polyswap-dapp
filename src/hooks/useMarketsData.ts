"use client";

import { getTradingAssetIds, type ProtocolVersion } from "@/lib/polymarket/protocol";
import { useQuery } from "@tanstack/react-query";
import {
  fetchClobPriceHistory,
  fetchClobPrices,
  getClobPrice,
  type ClobHistoryPoint,
  type ClobPriceRequest,
  type ClobPricesResponse,
} from "@/services/polymarket";
import { apiService, readApiErrorMessage } from "@/services/api";
import {
  MARKET_CATEGORIES,
  type MarketCategory,
  type MarketViewModel,
  type Side,
} from "@/types/design";
import {
  RECOMMENDATION_POLICY,
  type OddsRange,
  type RecommendationPage,
} from "@/lib/marketRecommendations";

export interface MarketOption {
  text: string;
  odds: number;
}

export interface ApiMarket {
  id: string;
  title: string;
  volume: number;
  endDate: string;
  category: string;
  type: "binary" | "multi-choice";
  yesOdds?: number;
  noOdds?: number;
  /** Lowest live ask for the YES token, as a 0..100 percentage. */
  yesBestAsk?: number;
  /** Lowest live ask for the NO token, as a 0..100 percentage. */
  noBestAsk?: number;
  /** Token id mapped to the displayed YES probability (for fetching history). */
  yesTokenId?: string;
  /** Token id for the NO side — paired with `yesTokenId` for binary markets. */
  noTokenId?: string;
  options?: MarketOption[];
  conditionId?: string;
  slug: string;
  eventSlug?: string;
  clobTokenIds: string[];
  protocolVersion: ProtocolVersion | null;
  positionIds: string[];
  description?: string;
}

interface SearchMarket {
  id: string;
  slug: string;
  event_slug: string | null;
  question: string;
  description: string | null;
  category: string | null;
  tags: string[];
  outcomes: string[];
  volume: number;
  liquidity: number;
  end_date: string | null;
  clob_token_ids: string[];
  protocol_version: ProtocolVersion | null;
  position_ids: string[];
  condition_id: string | null;
  active: boolean;
}

interface SearchResponse {
  success: boolean;
  data: {
    markets: SearchMarket[];
    count: number;
    total: number;
  };
}

interface CountsResponse {
  success: boolean;
  data: {
    byCategory: Record<string, number>;
    total: number;
  };
}

const CANONICAL_BY_LOWER: ReadonlyMap<string, MarketCategory> = new Map(
  MARKET_CATEGORIES.map((c) => [c.toLowerCase(), c])
);

export function normalizeCategory(raw: string): MarketCategory | null {
  return CANONICAL_BY_LOWER.get(raw.trim().toLowerCase()) ?? null;
}

export function isDesignCategory(c: string): c is MarketCategory {
  return CANONICAL_BY_LOWER.has(c.toLowerCase());
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

function mergeMarket(lean: SearchMarket, prices: ClobPricesResponse): ApiMarket {
  const outcomes = lean.outcomes;
  const clobTokenIds = getTradingAssetIds({
    protocolVersion: lean.protocol_version,
    clobTokenIds: lean.clob_token_ids,
    positionIds: lean.position_ids,
    outcomes: lean.outcomes,
  });
  const endDate = lean.end_date ?? "";
  const category = lean.category ?? "";
  const description = lean.description ?? undefined;
  // Postgres NUMERIC arrives as string over JSON — coerce up-front so
  // downstream formatters (fmtUSD) don't fall back to the em-dash placeholder.
  const volume = Number(lean.volume) || 0;

  const isTraditionalBinary =
    outcomes.length === 2 && outcomes.includes("Yes") && outcomes.includes("No");

  if (isTraditionalBinary) {
    const yesIdx = outcomes.indexOf("Yes");
    const noIdx = outcomes.indexOf("No");
    return {
      id: lean.id,
      title: lean.question,
      volume,
      endDate,
      category,
      type: "binary",
      yesOdds: midpointPercent(prices, clobTokenIds[yesIdx]),
      noOdds: midpointPercent(prices, clobTokenIds[noIdx]),
      yesBestAsk: bestAskPercent(prices, clobTokenIds[yesIdx]),
      noBestAsk: bestAskPercent(prices, clobTokenIds[noIdx]),
      yesTokenId: clobTokenIds[yesIdx],
      noTokenId: clobTokenIds[noIdx],
      slug: lean.slug,
      eventSlug: lean.event_slug ?? undefined,
      clobTokenIds: lean.clob_token_ids,
      protocolVersion: lean.protocol_version,
      positionIds: lean.position_ids,
      conditionId: lean.condition_id ?? undefined,
      description,
    };
  }

  if (outcomes.length === 2) {
    return {
      id: lean.id,
      title: lean.question,
      volume,
      endDate,
      category,
      type: "binary",
      yesOdds: midpointPercent(prices, clobTokenIds[0]),
      noOdds: midpointPercent(prices, clobTokenIds[1]),
      yesBestAsk: bestAskPercent(prices, clobTokenIds[0]),
      noBestAsk: bestAskPercent(prices, clobTokenIds[1]),
      yesTokenId: clobTokenIds[0],
      noTokenId: clobTokenIds[1],
      slug: lean.slug,
      eventSlug: lean.event_slug ?? undefined,
      clobTokenIds: lean.clob_token_ids,
      protocolVersion: lean.protocol_version,
      positionIds: lean.position_ids,
      conditionId: lean.condition_id ?? undefined,
      description,
    };
  }

  const options: MarketOption[] = outcomes.map((label, i) => ({
    text: label,
    odds: midpointPercent(prices, clobTokenIds[i]),
  }));
  return {
    id: lean.id,
    title: lean.question,
    volume,
    endDate,
    category,
    type: "multi-choice",
    options,
    slug: lean.slug,
    eventSlug: lean.event_slug ?? undefined,
    clobTokenIds: lean.clob_token_ids,
    protocolVersion: lean.protocol_version,
    positionIds: lean.position_ids,
    conditionId: lean.condition_id ?? undefined,
    description,
  };
}

export function toViewModel(api: ApiMarket): MarketViewModel | null {
  const category = normalizeCategory(api.category);
  if (!category) return null;
  if (api.type !== "binary") return null;
  // yesOdds arrives as a 0..100 percentage (from CLOB midpoint × 100); the
  // view model exposes a 0..1 probability that the row component scales.
  const yesProbability = (api.yesOdds ?? 0) / 100;
  return {
    id: api.id,
    slug: api.slug,
    eventSlug: api.eventSlug ?? null,
    yesTokenId: api.yesTokenId ?? null,
    noTokenId: api.noTokenId ?? null,
    category,
    question: api.title,
    yesProbability,
    yesBestAsk: api.yesBestAsk === undefined ? null : api.yesBestAsk / 100,
    noBestAsk: api.noBestAsk === undefined ? null : api.noBestAsk / 100,
    volume24h: null,
    volumeTotal: api.volume,
    endsAt: api.endDate,
  };
}

const STALE = 60_000;

function tokenPriceRequests(markets: SearchMarket[]): ClobPriceRequest[] {
  const requests: ClobPriceRequest[] = [];
  for (const m of markets) {
    for (const tokenId of getTradingAssetIds({
      protocolVersion: m.protocol_version,
      outcomes: m.outcomes,
      clobTokenIds: m.clob_token_ids,
      positionIds: m.position_ids,
    })) {
      requests.push({ token_id: tokenId, side: "BUY" });
      requests.push({ token_id: tokenId, side: "SELL" });
    }
  }
  return requests;
}

interface SearchAndHydrateResult {
  items: ApiMarket[];
  total: number;
}

async function searchAndHydrate(params: {
  sort?: string;
  limit?: number;
  offset?: number;
  q?: string;
  category?: string;
  categories?: ReadonlyArray<string>;
}): Promise<SearchAndHydrateResult> {
  const url = new URL("/api/markets/search", window.location.origin);
  if (params.sort) url.searchParams.set("sort", params.sort);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) url.searchParams.set("offset", String(params.offset));
  if (params.q) url.searchParams.set("q", params.q);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.categories && params.categories.length > 0) {
    url.searchParams.set("categories", params.categories.join(","));
  }

  const res = await fetch(url.toString());
  const payload: unknown = await res.json();
  if (!res.ok) {
    throw new Error(readApiErrorMessage(payload) ?? `markets/search failed: ${res.status}`);
  }
  const json = payload as SearchResponse;

  if (!json.success) throw new Error("markets/search returned success=false");

  const leanMarkets = json.data.markets;
  const total = json.data.total ?? 0;
  if (leanMarkets.length === 0) return { items: [], total };

  const prices = await fetchClobPrices(tokenPriceRequests(leanMarkets));

  return {
    items: leanMarkets.map((lean) => mergeMarket(lean, prices)),
    total,
  };
}

async function fetchSingleMarket(
  slug: string,
  opts: { track?: boolean } = {}
): Promise<ApiMarket | null> {
  const lean = await apiService.getMarketBySlug(slug, opts);
  if (!lean) return null;
  const endDate =
    lean.end_date instanceof Date
      ? lean.end_date.toISOString()
      : (lean.end_date as unknown as string | null);
  const search: SearchMarket = {
    id: lean.id,
    slug: lean.slug,
    event_slug: lean.event_slug,
    question: lean.question,
    description: lean.description,
    category: lean.category,
    tags: lean.tags,
    outcomes: lean.outcomes,
    volume: Number(lean.volume) || 0,
    liquidity: Number(lean.liquidity) || 0,
    end_date: endDate,
    clob_token_ids: lean.clob_token_ids,
    protocol_version: lean.protocol_version,
    position_ids: lean.position_ids,
    condition_id: lean.condition_id,
    active: lean.active,
  };
  const prices = await fetchClobPrices(tokenPriceRequests([search]));
  return mergeMarket(search, prices);
}

interface UseMarketsPageParams {
  page: number;
  pageSize: number;
  q?: string;
  category: MarketCategory | null;
}

export function useMarketsPage({ page, pageSize, q, category }: UseMarketsPageParams) {
  const trimmed = q?.trim() ?? "";
  const offset = (page - 1) * pageSize;
  return useQuery({
    queryKey: ["markets", "page", trimmed, category, page, pageSize],
    queryFn: () =>
      searchAndHydrate({
        q: trimmed.length > 0 ? trimmed : undefined,
        category: category ?? undefined,
        sort: "interest",
        limit: pageSize,
        offset,
      }),
    staleTime: STALE,
    select: ({ items, total }) => ({
      items: items.map(toViewModel).filter((m): m is MarketViewModel => m !== null),
      total,
    }),
  });
}

interface UseRecommendedMarketsParams extends OddsRange {
  page: number;
  pageSize: number;
  category: MarketCategory | null;
}

export function useRecommendedMarkets({
  page,
  pageSize,
  category,
  oddsMin,
  oddsMax,
}: UseRecommendedMarketsParams) {
  return useQuery({
    queryKey: ["markets", "recommended", category, oddsMin, oddsMax, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        oddsMin: String(oddsMin),
        oddsMax: String(oddsMax),
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      if (category) params.set("category", category);
      const res = await fetch(`/api/markets/recommended?${params}`);
      const payload: unknown = await res.json();
      if (!res.ok) {
        throw new Error(readApiErrorMessage(payload) ?? "Couldn’t load recommendations.");
      }
      const json = payload as { success: boolean; data: RecommendationPage };
      if (!json.success) throw new Error("Couldn’t load recommendations.");
      const data = json.data;
      if (data.source === "database") {
        const prices = data.markets.length
          ? await fetchClobPrices(tokenPriceRequests(data.markets))
          : {};
        return {
          ...data,
          items: data.markets
            .map((market) => toViewModel(mergeMarket(market, prices)))
            .filter((market): market is MarketViewModel => market !== null),
        };
      }
      return {
        ...data,
        items: data.markets.map(
          (market): MarketViewModel => ({
            ...market,
            yesBestAsk: null,
            noBestAsk: null,
          })
        ),
      };
    },
    staleTime: RECOMMENDATION_POLICY.cacheMs,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Real Polymarket CLOB price history for the YES side of a binary market.
 * `days` clips to the most recent N days; pass 0 for the full series.
 */
export function useMarketPriceHistory(tokenId: string | null | undefined, days = 60) {
  return useQuery({
    queryKey: ["market-history", tokenId, days],
    queryFn: async (): Promise<ClobHistoryPoint[]> => {
      if (!tokenId) return [];
      const all = await fetchClobPriceHistory(tokenId);
      if (days <= 0 || all.length === 0) return all;
      const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
      const sliced = all.filter((p) => p.t >= cutoff);
      return sliced.length >= 2 ? sliced : all;
    },
    enabled: typeof tokenId === "string" && tokenId.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => !/429/.test(error.message) && failureCount < 1,
  });
}

export interface TagSuggestion {
  tag: string;
  count: number;
}

interface SuggestResponse {
  success: boolean;
  data: TagSuggestion[];
}

export function useSearchSuggestions(prefix: string, enabled = true) {
  const trimmed = prefix.trim();
  return useQuery({
    queryKey: ["markets", "suggest", trimmed],
    queryFn: async (): Promise<TagSuggestion[]> => {
      if (trimmed.length === 0) return [];
      const url = new URL("/api/markets/suggest", window.location.origin);
      url.searchParams.set("q", trimmed);
      url.searchParams.set("limit", "8");
      const res = await fetch(url.toString());
      const payload: unknown = await res.json();
      if (!res.ok) {
        throw new Error(readApiErrorMessage(payload) ?? `markets/suggest failed: ${res.status}`);
      }
      const json = payload as SuggestResponse;
      if (!json.success) throw new Error("markets/suggest returned success=false");
      return json.data;
    },
    enabled: enabled && trimmed.length > 0,
    staleTime: STALE,
  });
}

export function useCategoryCounts(categories: ReadonlyArray<string>) {
  const key = categories.join(",");
  return useQuery({
    queryKey: ["markets", "counts", key],
    queryFn: async (): Promise<{ byCategory: Record<string, number>; total: number }> => {
      if (categories.length === 0) return { byCategory: {}, total: 0 };
      const url = new URL("/api/markets/counts", window.location.origin);
      url.searchParams.set("categories", key);
      const res = await fetch(url.toString());
      const payload: unknown = await res.json();
      if (!res.ok) {
        throw new Error(readApiErrorMessage(payload) ?? `markets/counts failed: ${res.status}`);
      }
      const json = payload as CountsResponse;
      if (!json.success) throw new Error("markets/counts returned success=false");
      return json.data;
    },
    staleTime: STALE,
  });
}

/**
 * `opts.track` opts the caller into server-side view counting (passed as
 * `?track=1` on the GET). Included in the query key so the tracked variant
 * never dedupes against side-traffic from `SwapRow`/`CreatePage` — visiting
 * the market detail page is always a real fetch and a real increment.
 */
export function useMarket(identifier: string, opts: { track?: boolean } = {}) {
  return useQuery({
    queryKey: ["market", identifier, opts.track ? "tracked" : "untracked"],
    queryFn: () => fetchSingleMarket(identifier, opts),
    staleTime: STALE,
    select: (api) => (api ? toViewModel(api) : null),
  });
}

export function useRawMarket(identifier: string) {
  return useQuery({
    queryKey: ["market", identifier, "untracked"],
    queryFn: () => fetchSingleMarket(identifier),
    staleTime: STALE,
  });
}

export function thresholdSide(probability: number): Side {
  return probability >= 0.5 ? "YES" : "NO";
}
