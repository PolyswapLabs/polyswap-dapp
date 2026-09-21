"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useMarket, useMarketPriceHistory } from "@/hooks/useMarketsData";
import { Button, DetailSkeleton, Tag, Tape, Dial } from "@/components/primitives";
import { CategoryIcon, Icon, PolymarketIcon } from "@/components/icons";
import { fmtUSD, fmtDate } from "@/lib/format";
import { getErrorMessage } from "@/lib/errorMessage";
import { capturePostHogEvent } from "@/lib/posthog-client";

interface Props {
  identifier: string;
}

export function MarketDetail({ identifier }: Props) {
  const lastTrackedMarket = useRef<string | null>(null);
  // `track: true` opts this fetch into server-side view counting — handled
  // inside GET /api/markets/[slug] when `?track=1` is set. Keeps tracking
  // tied to the existing market lookup instead of a dedicated /view route.
  const { data, isLoading, isError, error } = useMarket(identifier, { track: true });
  const { data: history = [] } = useMarketPriceHistory(data?.yesTokenId, 60);

  useEffect(() => {
    if (!data || lastTrackedMarket.current === data.id) return;
    lastTrackedMarket.current = data.id;
    capturePostHogEvent("market_viewed", { market_id: data.id, category: data.category });
  }, [data]);

  if (isLoading) {
    return <DetailSkeleton />;
  }
  if (isError || !data) {
    return (
      <div className="py-16 text-center text-sm text-ink-3">
        {isError
          ? `We couldn't load that market. ${getErrorMessage(error, "Try again in a moment.")}`
          : "We couldn't find that market."}{" "}
        <Link href="/markets" className="underline">
          Back to markets
        </Link>
        .
      </div>
    );
  }

  const yesPct = Math.round(data.yesProbability * 100);

  // If the trade history spans fewer than 60 days the market was likely
  // created recently — say so instead of pretending it's a 60-day window.
  const spanSeconds = history.length >= 2 ? history[history.length - 1]!.t - history[0]!.t : 0;
  const chartRangeLabel =
    history.length < 2
      ? "no history yet"
      : spanSeconds >= 60 * 86400
        ? "last 60 days"
        : "since market creation";

  return (
    <div className="pb-24">
      <div className="border-b border-ink py-6 lg:py-8">
        <Link
          href="/markets"
          className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink"
        >
          <Icon.arrowLeft size={12} aria-hidden /> Back to markets
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Tag tone="ink">
            <CategoryIcon category={data.category} size={12} />
            {data.category}
          </Tag>
          <span className="text-xs text-ink-3">Ends {fmtDate(data.endsAt)}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4 lg:mt-5">
          <h1
            className="max-w-[820px] font-serif text-3xl leading-[1.1] sm:text-4xl lg:text-[44px]"
            style={{ viewTransitionName: `market-title-${data.id}` }}
          >
            {data.question}
          </h1>
          <a
            href={`https://polymarket.com/event/${data.eventSlug ?? data.slug}`}
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
            <Stat label="24h volume" value={fmtUSD(data.volume24h, { compact: true })} />
            <Stat label="Resolves" value={fmtDate(data.endsAt)} />
          </div>

          {/* Chart */}
          <section>
            <p className="eyebrow mb-3">Probability of YES · {chartRangeLabel}</p>
            <div className="overflow-hidden border border-ink bg-paper p-4 lg:p-6">
              <div className="flex items-stretch gap-3">
                <div className="num flex flex-col justify-between py-1 text-[11px] text-ink-3">
                  <span>100%</span>
                  <span>75%</span>
                  <span>50%</span>
                  <span>25%</span>
                  <span>0%</span>
                </div>
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
              set a swap and the YES odds cross your threshold before {fmtDate(data.endsAt)}, your
              swap fires. Otherwise it expires and your tokens stay where they are.
            </p>
          </section>
        </div>

        {/* Right rail / sticky CTA */}
        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-6 lg:space-y-6">
            <div className="border border-ink bg-paper-2 p-6">
              <div className="flex items-center gap-4">
                <Dial current={data.yesProbability} threshold={1} side="YES" size={64} animate />
                <div>
                  <p className="num text-2xl font-semibold">{yesPct}%</p>
                  <p className="text-xs text-ink-3">YES today</p>
                </div>
              </div>
              <p className="mt-4 font-serif text-lg leading-snug">
                Set a swap that fires only when this question crosses your line.
              </p>
              <Link href={`/create/${data.id}`} className="mt-5 inline-flex">
                <Button variant="accent" size="lg">
                  Set up a swap
                  <Icon.arrowRight size={14} aria-hidden />
                </Button>
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
