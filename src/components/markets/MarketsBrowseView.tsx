"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CategoryFilter, type CategoryFilterValue } from "./CategoryFilter";
import { MarketRow } from "./MarketRow";
import { MarketsSkeleton } from "./MarketsSkeleton";
import { Pagination } from "./Pagination";
import { MARKETS_PAGE_SIZE, MarketsEmptyState, MarketsPageHeader } from "./MarketsPageBlocks";
import { MotionList, MotionItem } from "@/components/primitives/MotionList";
import { useRecommendedMarkets } from "@/hooks/markets/useMarkets";
import { getErrorMessage } from "@/utils/errors";
import { CRYPTO_RELEVANT_CATEGORIES, type MarketCategory } from "@/shared/markets/categories";
import { capturePostHogEvent } from "@/client/analytics";
import { RECOMMENDATION_POLICY } from "@/shared/markets/recommendationPolicy";

export function MarketsBrowseView() {
  const router = useRouter();
  const params = useSearchParams();
  const rawCategory = params.get("category") as MarketCategory | null;
  const category: CategoryFilterValue =
    rawCategory && CRYPTO_RELEVANT_CATEGORIES.includes(rawCategory) ? rawCategory : "All";
  const oddsMin = RECOMMENDATION_POLICY.oddsMin;
  const oddsMax = RECOMMENDATION_POLICY.oddsMax;
  const rawPage = Number(params.get("page") ?? 1);
  const page =
    Number.isSafeInteger(rawPage) && rawPage >= 1
      ? Math.min(rawPage, Math.ceil(RECOMMENDATION_POLICY.candidateLimit / MARKETS_PAGE_SIZE))
      : 1;
  const lastTrackedView = useRef<string | null>(null);

  const searchCat: MarketCategory | null = category === "All" ? null : category;

  const { data, isLoading, isFetching, isError, error, refetch } = useRecommendedMarkets({
    page,
    pageSize: MARKETS_PAGE_SIZE,
    category: searchCat,
    oddsMin,
    oddsMax,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const listKey = `${category}-${page}`;

  const updateFilters = useCallback(
    (next: { category?: CategoryFilterValue; page?: number }) => {
      const newCategory = next.category ?? category;
      const newPage = next.page ?? page;
      const query = new URLSearchParams();
      if (newCategory !== "All") query.set("category", newCategory);
      if (newPage > 1) query.set("page", String(newPage));
      const suffix = query.toString();
      router.push(`/markets${suffix ? `?${suffix}` : ""}`, { scroll: false });
    },
    [category, page, router]
  );

  useEffect(() => {
    if (!data || isLoading || isError) return;
    const lastPage = Math.max(1, Math.ceil(data.total / MARKETS_PAGE_SIZE));
    if (page > lastPage) updateFilters({ page: lastPage });
  }, [data, isLoading, isError, page, updateFilters]);

  useEffect(() => {
    if (!data || isLoading || isError || lastTrackedView.current === listKey) return;
    lastTrackedView.current = listKey;
    capturePostHogEvent("market_list_viewed", {
      source: "browse",
      category,
      page,
      recommendation_source: data.source,
      odds_min: data.source === "gamma" ? oddsMin : null,
      odds_max: data.source === "gamma" ? oddsMax : null,
      result_count: total,
    });
  }, [data, isLoading, isError, listKey, category, oddsMin, oddsMax, page, total]);

  const handleCategoryChange = (next: CategoryFilterValue) => {
    if (next === category) return;
    capturePostHogEvent("market_category_selected", { category: next });
    updateFilters({ category: next, page: 1 });
  };

  const handleSearchSubmit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length > 0) {
      router.push(`/markets/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <div>
      <MarketsPageHeader
        subtitle="The ones most likely to move crypto prices come first."
        title="Pick a question."
        searchValue=""
        onSearchSubmit={handleSearchSubmit}
      />

      <CategoryFilter value={category} onChange={handleCategoryChange} />

      {data?.source === "database" && !isError && (
        <p className="border-b border-rule-soft px-4 py-3 text-sm text-ink-3 sm:px-6" role="status">
          Recommendations are temporarily unavailable. Showing active markets.
        </p>
      )}

      {isLoading && <MarketsSkeleton />}
      {isError && (
        <div className="px-4 py-12 text-center text-sm text-ink-3 sm:px-6" role="status">
          <p>
            Couldn&apos;t load recommendations.{" "}
            {getErrorMessage(error, "Try again in a moment, or use search.")}
          </p>
          <button
            type="button"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="mt-4 border border-ink px-4 py-2 text-ink hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-50"
          >
            Try again
          </button>
        </div>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <MarketsEmptyState
          title="Nothing fits that brief."
          hint="Pick a different category, or search for a market."
        />
      )}
      {!isLoading && !isError && items.length > 0 && (
        <>
          <MotionList key={listKey} className="-mx-4 sm:mx-0">
            {items.map((m) => (
              <MotionItem key={m.id}>
                <MarketRow market={m} displayCategory={searchCat ?? undefined} source="browse" />
              </MotionItem>
            ))}
          </MotionList>
          <Pagination
            page={page}
            pageSize={MARKETS_PAGE_SIZE}
            total={total}
            onChange={(next) => updateFilters({ page: next })}
          />
        </>
      )}
    </div>
  );
}
