"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketCategory } from "@/shared/markets/categories";
import { RECOMMENDATION_POLICY } from "@/shared/markets/recommendationPolicy";
import {
  fetchPricedMarket,
  fetchRecentPriceHistory,
  fetchRecommendedMarkets,
  fetchTagSuggestions,
  searchPricedMarkets,
  type RecommendedMarketsQuery,
} from "./marketFetchers";
import { isMarketViewModel, toMarketViewModel } from "./marketMapper";

const MARKET_DATA_STALE_MS = 60_000;
const PRICE_HISTORY_STALE_MS = 5 * 60_000;

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
      searchPricedMarkets({
        q: trimmed.length > 0 ? trimmed : undefined,
        category: category ?? undefined,
        sort: "interest",
        limit: pageSize,
        offset,
      }),
    staleTime: MARKET_DATA_STALE_MS,
    select: ({ items, total }) => ({
      items: items.map(toMarketViewModel).filter(isMarketViewModel),
      total,
    }),
  });
}

export function useRecommendedMarkets(query: RecommendedMarketsQuery) {
  const { page, pageSize, category, oddsMin, oddsMax } = query;
  return useQuery({
    queryKey: ["markets", "recommended", category, oddsMin, oddsMax, page, pageSize],
    queryFn: () => fetchRecommendedMarkets(query),
    staleTime: RECOMMENDATION_POLICY.cacheMs,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * `opts.track` opts the caller into server-side view counting (passed as
 * `?track=1` on the GET). Included in the query key so the tracked variant
 * never dedupes against side-traffic from `SwapRow`/`CreateSwapView` — visiting
 * the market detail page is always a real fetch and a real increment.
 */
export function marketQueryOptions(identifier: string, opts: { track?: boolean } = {}) {
  return {
    queryKey: ["market", identifier, opts.track ? "tracked" : "untracked"],
    queryFn: () => fetchPricedMarket(identifier, opts),
    staleTime: MARKET_DATA_STALE_MS,
    select: toMarketViewModel,
    enabled: identifier.length > 0,
  };
}

export function useMarket(identifier: string, opts: { track?: boolean } = {}) {
  return useQuery(marketQueryOptions(identifier, opts));
}

/**
 * Real Polymarket CLOB price history for the YES side of a binary market.
 * `days` clips to the most recent N days; pass 0 for the full series.
 */
export function useMarketPriceHistory(tokenId: string | null | undefined, days = 60) {
  return useQuery({
    queryKey: ["market-history", tokenId, days],
    queryFn: () => fetchRecentPriceHistory(tokenId, days),
    enabled: typeof tokenId === "string" && tokenId.length > 0,
    staleTime: PRICE_HISTORY_STALE_MS,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => !/429/.test(error.message) && failureCount < 1,
  });
}

export function useSearchSuggestions(prefix: string, enabled = true) {
  const trimmed = prefix.trim();
  return useQuery({
    queryKey: ["markets", "suggest", trimmed],
    queryFn: () => fetchTagSuggestions(trimmed),
    enabled: enabled && trimmed.length > 0,
    staleTime: MARKET_DATA_STALE_MS,
  });
}
