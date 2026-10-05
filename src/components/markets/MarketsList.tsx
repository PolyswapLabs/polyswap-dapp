"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CategoryFilter, type CategoryFilterValue } from "./CategoryFilter";
import { SearchInputWithSuggestions } from "./SearchInputWithSuggestions";
import { MarketRow } from "./MarketRow";
import { MarketsSkeleton } from "./MarketsSkeleton";
import { Pagination } from "./Pagination";
import { MotionList, MotionItem } from "@/components/primitives";
import { useRecommendedMarkets } from "@/hooks/useMarketsData";
import { getErrorMessage } from "@/lib/errorMessage";
import { CRYPTO_RELEVANT_CATEGORIES, type MarketCategory } from "@/types/design";
import { capturePostHogEvent } from "@/lib/posthog-client";
import { RECOMMENDATION_POLICY } from "@/lib/marketRecommendations";

const PAGE_SIZE = 20;

export function MarketsList() {
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
      ? Math.min(rawPage, Math.ceil(RECOMMENDATION_POLICY.candidateLimit / PAGE_SIZE))
      : 1;
  const lastTrackedView = useRef<string | null>(null);

  const searchCat: MarketCategory | null = category === "All" ? null : category;

  const { data, isLoading, isFetching, isError, error, refetch } = useRecommendedMarkets({
    page,
    pageSize: PAGE_SIZE,
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
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
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
      <div className="border-b border-ink">
        <div className="grid items-end gap-6 py-10 lg:grid-cols-12 lg:gap-10 lg:py-14">
          <div className="lg:col-span-7">
            <p className="eyebrow mb-3">Markets · prioritized for crypto impact</p>
            <h1 className="display text-4xl leading-[0.95] sm:text-5xl lg:text-[64px]">
              The <span className="display-italic">paper</span>
              <br />
              of record.
            </h1>
          </div>
          <div className="lg:col-span-5">
            <SearchInputWithSuggestions
              value=""
              onSubmit={handleSearchSubmit}
              placeholder="Search questions, tags, slugs"
              className="w-full"
            />
          </div>
        </div>
      </div>

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
        <div className="border-b border-rule-soft px-6 py-16 text-center sm:px-8 lg:py-20">
          <p className="font-serif text-xl text-ink sm:text-2xl">Nothing fits that brief.</p>
          <p className="mt-2 text-sm text-ink-3">
            Pick a different category, or search for a market.
          </p>
        </div>
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
            pageSize={PAGE_SIZE}
            total={total}
            onChange={(next) => updateFilters({ page: next })}
          />
        </>
      )}
    </div>
  );
}
