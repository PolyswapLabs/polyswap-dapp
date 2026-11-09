"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useMarket, useMarketPriceHistory } from "@/hooks/markets/useMarkets";
import { cn } from "@/utils/cn";
import { Dial } from "@/components/charts/Dial";
import { Tape } from "@/components/charts/Tape";
import { buttonVariants } from "@/components/primitives/Button";
import { DetailSkeleton } from "@/components/primitives/DetailSkeleton";
import { PageMessage, BackLink, OddsAxis } from "@/components/primitives/PageBlocks";
import { Tag } from "@/components/primitives/Tag";
import { CategoryIcon, Icon, PolymarketIcon } from "@/components/icons";
import { formatUsd, formatDate } from "@/utils/format";
import { getErrorMessage } from "@/utils/errors";
import { marketTitleTransitionName, polymarketEventUrl } from "@/utils/links";
import { capturePostHogEvent } from "@/client/analytics";
import { DAY_SECONDS } from "@/utils/time";

interface Props {
  marketIdOrSlug: string;
}

export function MarketDetailView({ marketIdOrSlug }: Props) {
  const lastTrackedMarket = useRef<string | null>(null);
  // `track: true` opts this fetch into server-side view counting — handled
  // inside GET /api/markets/[slug] when `?track=1` is set. Keeps tracking
  // tied to the existing market lookup instead of a dedicated /view route.
  const { data: market, isLoading, isError, error } = useMarket(marketIdOrSlug, { track: true });
  const { data: history = [] } = useMarketPriceHistory(market?.yesTokenId, 60);

  useEffect(() => {
    if (!market || lastTrackedMarket.current === market.id) return;
    lastTrackedMarket.current = market.id;
    capturePostHogEvent("market_viewed", { market_id: market.id, category: market.category });
  }, [market]);

  if (isLoading) {
    return <DetailSkeleton />;
  }
  if (isError || !market) {
    return (
      <PageMessage>
        {isError
          ? `We couldn't load that market. ${getErrorMessage(error, "Try again in a moment.")}`
          : "We couldn't find that market."}{" "}
        <Link href="/markets" className="underline">
          Back to markets
        </Link>
        .
      </PageMessage>
    );
  }

  const yesPct = Math.round(market.yesProbability * 100);

  // If the trade history spans fewer than 60 days the market was likely
  // created recently — say so instead of pretending it's a 60-day window.
  const spanSeconds = history.length >= 2 ? history[history.length - 1]!.t - history[0]!.t : 0;
  const chartRangeLabel =
    history.length < 2
      ? "no history yet"
      : spanSeconds >= 60 * DAY_SECONDS
        ? "last 60 days"
        : "since market creation";

  return (
    <div className="pb-24">
      <div className="border-b border-ink py-6 lg:py-8">
        <BackLink href="/markets">Back to markets</BackLink>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Tag tone="ink">
            <CategoryIcon category={market.category} size={12} />
            {market.category}
          </Tag>
          <span className="text-xs text-ink-3">Ends {formatDate(market.endsAt)}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4 lg:mt-5">
          <h1
            className="max-w-[820px] font-serif text-3xl leading-[1.1] sm:text-4xl lg:text-[44px]"
            style={{ viewTransitionName: marketTitleTransitionName(market.id) }}
          >
            {market.question}
          </h1>
          <a
            href={polymarketEventUrl(market)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex shrink-0 items-center gap-2 border border-ink bg-paper px-3 py-2 text-sm text-ink transition-colors hover:bg-paper-2"
            aria-label="View this market on Polymarket"
          >
            <PolymarketIcon size={28} className="text-ink" />
            <span>Polymarket</span>
            <Icon.arrowUpRight size={18} aria-hidden />
          </a>
        </div>
      </div>

      <div className="grid gap-10 py-8 lg:grid-cols-12 lg:py-12">
        <div className="space-y-8 lg:col-span-8">
          {/* Stat strip */}
          <div className="grid grid-cols-3 border border-ink">
            <Stat label="Current YES odds" value={`${yesPct}%`} accent />
            <Stat
              label={market.volume24h === null ? "Total volume" : "24h volume"}
              value={formatUsd(market.volume24h ?? market.volumeTotal, { compact: true })}
            />
            <Stat label="Resolves" value={formatDate(market.endsAt)} />
          </div>

          {/* Chart */}
          <section>
            <p className="eyebrow mb-3">Probability of YES · {chartRangeLabel}</p>
            <div className="overflow-hidden border border-ink bg-paper p-4 lg:p-6">
              <div className="flex items-stretch gap-3">
                <OddsAxis />
                <div className="min-w-0 flex-1">
                  {history.length >= 2 ? (
                    <Tape
                      data={history.map((h) => h.p)}
                      timestamps={history.map((h) => h.t)}
                      showThreshold={false}
                      side="YES"
                      width={760}
                      height={220}
                      className="w-full"
                      animate
                      interactive
                    />
                  ) : (
                    <div className="flex h-[220px] items-center justify-center text-sm text-ink-3">
                      No trade history yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Resolution rules */}
          <section>
            <p className="eyebrow mb-3">How it resolves</p>
            <p className="max-w-[640px] font-serif text-base leading-relaxed text-ink-2 lg:text-lg">
              This market resolves on Polymarket. Polyswap reads the same odds you see there. If you
              set a swap and the YES odds cross your threshold before {formatDate(market.endsAt)},
              your swap fires. Otherwise it expires and your tokens stay where they are.
            </p>
          </section>
        </div>

        {/* Right rail / sticky CTA */}
        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-6 lg:space-y-6">
            <div className="border border-ink bg-paper-2 p-6">
              <div className="flex items-center gap-4">
                <Dial current={market.yesProbability} threshold={1} side="YES" size={64} animate />
                <div>
                  <p className="num text-2xl font-semibold">{yesPct}%</p>
                  <p className="text-xs text-ink-3">YES today</p>
                </div>
              </div>
              <p className="mt-4 font-serif text-lg leading-snug">
                Set a swap that fires only when this question crosses your line.
              </p>
              <Link
                href={`/create/${market.id}`}
                className={cn(buttonVariants({ variant: "accent", size: "lg" }), "mt-5")}
              >
                Set up a swap
                <Icon.arrowRight size={14} aria-hidden />
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="border-r border-ink p-4 last:border-r-0 lg:p-5">
      <p className="eyebrow">{label}</p>
      <p
        className={`num mt-1 text-xl font-semibold lg:text-2xl ${accent ? "text-yes" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}
