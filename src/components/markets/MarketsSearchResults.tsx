"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MarketRow } from "./MarketRow";
import { MarketsSkeleton } from "./MarketsSkeleton";
import { Pagination } from "./Pagination";
import { MARKETS_PAGE_SIZE, MarketsEmptyState, MarketsPageHeader } from "./MarketsPageBlocks";
import { MotionList, MotionItem } from "@/components/primitives";
import { TransitionLink } from "@/components/layout";
import { Icon } from "@/components/icons";
import { useMarketsPage } from "@/hooks/markets/useMarkets";
import { getErrorMessage } from "@/lib/errorMessage";
import { capturePostHogEvent } from "@/lib/posthog-client";

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
    pageSize: MARKETS_PAGE_SIZE,
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
      <MarketsPageHeader
        aboveTitle={
          <TransitionLink
            href="/markets"
            className="inline-flex items-center gap-2 text-sm text-ink-3 hover:text-ink"
          >
            <Icon.arrowLeft size={14} />
            <span>All markets</span>
          </TransitionLink>
        }
        eyebrow={
          trimmed.length > 0
            ? `Search · ${total.toLocaleString()} match${total === 1 ? "" : "es"}`
            : "Search"
        }
        title={
          trimmed.length > 0 ? (
            <>
              Results for <span className="display-italic">{trimmed}</span>
            </>
          ) : (
            <>Find a market.</>
          )
        }
        searchValue={query}
        onSearchSubmit={handleQuerySubmit}
      />

      {trimmed.length === 0 ? (
        <MarketsEmptyState title="Type to search." hint="Match by question, tag or slug." />
      ) : (
        <>
          {isLoading && <MarketsSkeleton />}
          {isError && (
            <p className="px-4 py-12 text-center text-sm text-ink-3 sm:px-6">
              Couldn&apos;t load markets. {getErrorMessage(error, "Try again in a moment.")}
            </p>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <MarketsEmptyState title="No matches." hint="Try a different term." />
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
              <Pagination
                page={page}
                pageSize={MARKETS_PAGE_SIZE}
                total={total}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
