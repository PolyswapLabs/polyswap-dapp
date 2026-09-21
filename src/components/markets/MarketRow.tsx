"use client";

import { Tape } from "@/components/primitives";
import { TransitionLink } from "@/components/layout";
import { CategoryIcon, Icon } from "@/components/icons";
import { useMarketPriceHistory } from "@/hooks/useMarketsData";
import { fmtUSD, fmtDate } from "@/lib/format";
import type { MarketViewModel } from "@/types/design";
import { capturePostHogEvent } from "@/lib/posthog-client";

interface Props {
  market: MarketViewModel;
  /**
   * When the row is rendered inside a category-filtered list, surface that
   * category in the icon + label instead of the priority-derived primary —
   * keeps the row visually consistent with the filter the user clicked.
   */
  displayCategory?: MarketViewModel["category"];
  source: "browse" | "search";
}

/**
 * Single component renders both a desktop dense row and a stacked mobile card,
 * picked via responsive utility classes. Uses `TransitionLink` so the market
 * title morphs into the detail page heading via the View Transitions API
 * (where supported — falls back to immediate navigation).
 */
export function MarketRow({ market, displayCategory, source }: Props) {
  const yesValue = market.yesProbability * 100;
  const yesPct = yesValue % 1 === 0 ? yesValue.toFixed(0) : yesValue.toFixed(1);
  const category = displayCategory ?? market.category;
  const titleVTName = `market-title-${market.id}`;

  const { data: history = [] } = useMarketPriceHistory(market.yesTokenId, 60);
  const sparkData = history.map((h) => h.p);

  return (
    <TransitionLink
      href={`/markets/${market.id}`}
      onClick={() =>
        capturePostHogEvent("market_clicked", {
          market_id: market.id,
          category: market.category,
          source,
        })
      }
      className="group relative block border-b border-rule-soft bg-paper hover:bg-paper-2 before:absolute before:left-0 before:top-0 before:h-full before:w-0 before:bg-accent before:transition-[width] before:duration-200 before:ease-out before:content-[''] hover:before:w-1"
      data-testid="market-row"
    >
      {/* Desktop layout */}
      <div className="hidden items-center gap-4 px-6 py-4 lg:grid lg:grid-cols-[28px_1fr_120px_180px_120px_64px]">
        <span className="text-ink">
          <CategoryIcon category={category} size={18} />
        </span>
        <div className="min-w-0">
          <p
            className="line-clamp-2 max-w-[520px] font-serif text-lg leading-snug text-ink"
            style={{ viewTransitionName: titleVTName }}
          >
            {market.question}
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {category} · ends {fmtDate(market.endsAt)}
          </p>
        </div>
        <div className="text-right">
          <p className="num text-xl font-semibold text-yes">{yesPct}%</p>
          <p className="mt-0.5 text-[11px] text-ink-3">YES</p>
        </div>
        <div className="overflow-hidden">
          <Tape data={sparkData} showThreshold={false} side="YES" width={160} height={42} animate />
        </div>
        <p className="text-right text-sm">
          <span className="text-[11px] uppercase tracking-wide text-ink-3">vol </span>
          <span className="num">{fmtUSD(market.volume24h, { compact: true })}</span>
        </p>
        <span
          aria-hidden
          className="text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-ink"
        >
          <Icon.arrowRight size={18} />
        </span>
      </div>

      {/* Mobile / tablet layout */}
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs text-ink-3">
            <CategoryIcon category={category} size={14} />
            {category}
          </span>
          <span className="text-xs text-ink-3">
            <span className="uppercase tracking-wide">vol </span>
            <span className="num">{fmtUSD(market.volume24h, { compact: true })}</span>
          </span>
        </div>
        <p
          className="font-serif text-lg leading-snug"
          style={{ viewTransitionName: `${titleVTName}-m` }}
        >
          {market.question}
        </p>
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <p className="num text-2xl font-semibold text-yes">{yesPct}%</p>
            <p className="text-[11px] text-ink-3">YES odds</p>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <Tape
              data={sparkData}
              showThreshold={false}
              side="YES"
              width={220}
              height={48}
              className="w-full"
              animate
            />
          </div>
        </div>
        <p className="text-xs text-ink-3">Ends {fmtDate(market.endsAt)}</p>
      </div>
    </TransitionLink>
  );
}
