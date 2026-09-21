"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchInputWithSuggestions } from "./SearchInputWithSuggestions";
import { MarketRow } from "./MarketRow";
import { MarketsSkeleton } from "./MarketsSkeleton";
import { Pagination } from "./Pagination";
import { MotionList, MotionItem } from "@/components/primitives";
import { TransitionLink } from "@/components/layout";
import { Icon } from "@/components/icons";
import { useMarketsPage } from "@/hooks/useMarketsData";
import { getErrorMessage } from "@/lib/errorMessage";
import { capturePostHogEvent } from "@/lib/posthog-client";

const PAGE_SIZE = 20;

function readPage(raw: string | null): number {
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function MarketsSearchResults() {
  const router = useRouter();
  const params = useSearchParams();

  const initialQ = params.get("q") ?? "";
  const initialPage = readPage(params.get("page"));

  const [query, setQuery] = useState(initialQ);
  const [page, setPage] = useState(initialPage);
  const lastTrackedView = useRef<string | null>(null);

  useEffect(() => {
    setQuery(params.get("q") ?? "");
    setPage(readPage(params.get("page")));
  }, [params]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim().length > 0) next.set("q", query.trim());
    if (page > 1) next.set("page", String(page));
    const target = `/markets/search${next.toString() ? `?${next.toString()}` : ""}`;
    router.replace(target);
  }, [query, page, router]);

  const trimmed = query.trim();

  const { data, isLoading, isError, error } = useMarketsPage({
    page,
    pageSize: PAGE_SIZE,
    q: query,
    category: null,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const listKey = `${query}-${page}`;

  useEffect(() => {
    if (!query.trim() || !data || isLoading || isError || lastTrackedView.current === listKey) {
      return;
    }
    lastTrackedView.current = listKey;
    capturePostHogEvent("market_list_viewed", {
      source: "search",
      page,
      query_length: query.trim().length,
      result_count: total,
    });
  }, [data, isLoading, isError, listKey, page, query, total]);

  const handleQuerySubmit = (next: string) => {
    setQuery(next);
    setPage(1);
  };

  return (
    <div>
      <div className="border-b border-ink">
        <div className="flex flex-col gap-6 py-10 lg:py-14">
          <TransitionLink
            href="/markets"
            className="inline-flex items-center gap-2 text-sm text-ink-3 hover:text-ink"
          >
            <Icon.arrowLeft size={14} />
            <span>All markets</span>
          </TransitionLink>
          <div className="grid items-end gap-6 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-7">
              <p className="eyebrow mb-3">
                {trimmed.length > 0
                  ? `Search · ${total.toLocaleString()} match${total === 1 ? "" : "es"}`
                  : "Search"}
              </p>
              <h1 className="display text-4xl leading-[0.95] sm:text-5xl lg:text-[64px]">
                {trimmed.length > 0 ? (
                  <>
                    Results for <span className="display-italic">{trimmed}</span>
                  </>
                ) : (
                  <>Find a market.</>
                )}
              </h1>
            </div>
            <div className="lg:col-span-5">
              <SearchInputWithSuggestions
                value={query}
                onSubmit={handleQuerySubmit}
                placeholder="Search questions, tags, slugs"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>

      {trimmed.length === 0 ? (
        <div className="border-b border-rule-soft px-6 py-16 text-center sm:px-8 lg:py-20">
          <p className="font-serif text-xl text-ink sm:text-2xl">Type to search.</p>
          <p className="mt-2 text-sm text-ink-3">Match by question, tag or slug.</p>
        </div>
      ) : (
        <>
          {isLoading && <MarketsSkeleton />}
          {isError && (
            <p className="px-4 py-12 text-center text-sm text-ink-3 sm:px-6">
              Couldn&apos;t load markets. {getErrorMessage(error, "Try again in a moment.")}
            </p>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <div className="border-b border-rule-soft px-6 py-16 text-center sm:px-8 lg:py-20">
              <p className="font-serif text-xl text-ink sm:text-2xl">No matches.</p>
              <p className="mt-2 text-sm text-ink-3">Try a different term.</p>
            </div>
          )}
          {!isLoading && !isError && items.length > 0 && (
            <>
              <MotionList key={listKey} className="-mx-4 sm:mx-0">
                {items.map((m) => (
                  <MotionItem key={m.id}>
                    <MarketRow market={m} source="search" />
                  </MotionItem>
                ))}
              </MotionList>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
            </>
          )}
        </>
      )}
    </div>
  );
}
