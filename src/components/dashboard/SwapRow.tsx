"use client";

import Link from "next/link";
import { Dial, Shimmer, Status, Tape, TokenLogo } from "@/components/primitives";
import { Icon } from "@/components/icons";
import { fmtNum, fmtPointsAway } from "@/lib/format";
import { useMarket, useMarketPriceHistory } from "@/hooks/useMarketsData";
import type { OrderViewModel } from "@/hooks/useOrders";

interface Props {
  order: OrderViewModel;
}

export function SwapRow({ order }: Props) {
  // Real Polymarket history for the side this order picked. React Query dedups
  // across rows that share the same market+token, so the per-row fetch is cheap.
  const marketQ = useMarket(order.marketId ?? "");
  const market = marketQ.data;
  const sideTokenId =
    order.side === "NO" ? (market?.noTokenId ?? null) : (market?.yesTokenId ?? null);
  const historyQ = useMarketPriceHistory(sideTokenId, 60);
  const priceHistory = historyQ.data ?? [];

  // While market/history are still loading for an order that has a marketId,
  // we'd otherwise paint the synthetic `order.spark` and a placeholder 0% — so
  // the row visibly swaps content a moment later. Hold a skeleton instead.
  const expectingRealData = order.marketId !== null;
  const dataPending =
    expectingRealData &&
    (marketQ.isPending ||
      historyQ.isPending ||
      (market !== undefined &&
        sideTokenId !== null &&
        historyQ.isFetching &&
        priceHistory.length === 0));

  const useRealHistory = priceHistory.length >= 2;
  const sparkData = useRealHistory ? priceHistory.map((p) => p.p) : order.spark;
  const sparkTimestamps = useRealHistory ? priceHistory.map((p) => p.t) : undefined;
  const currentOdds = sparkData[sparkData.length - 1] ?? 0;
  const marketQuestion = market?.question ?? order.nickname;

  if (dataPending) {
    return <SwapRowSkeleton href={`/dashboard/${order.id}`} order={order} />;
  }
  return (
    <Link
      href={`/dashboard/${order.id}`}
      className="group block border-b border-rule-soft bg-paper hover:bg-paper-2"
    >
      {/* Desktop: dense row */}
      <div className="hidden items-center gap-4 px-6 py-4 lg:grid lg:grid-cols-[60px_1fr_180px_220px_28px]">
        <Dial
          current={currentOdds}
          threshold={order.threshold}
          side={order.side}
          triggerOn="drop"
          size={48}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <p className="truncate font-serif text-lg leading-tight">{marketQuestion}</p>
            <Status kind={order.status} />
          </div>
          <p className="mt-1 truncate text-xs text-ink-3">
            {order.nickname}
            {order.status === "waiting" && ` · ${fmtPointsAway(currentOdds, order.threshold)} away`}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <TokenLogo symbol={order.sellSymbol} logoURI={order.sellLogoURI} size={22} />
          <span className="num text-sm">
            {fmtNum(order.sellAmount, 2)} {order.sellSymbol}
          </span>
          <Icon.arrowRight size={12} className="text-ink-3" aria-hidden />
          <TokenLogo symbol={order.buySymbol} logoURI={order.buyLogoURI} size={22} />
        </div>
        <div className="overflow-hidden">
          <Tape
            data={sparkData}
            timestamps={sparkTimestamps}
            threshold={order.threshold}
            side={order.side}
            width={200}
            height={42}
            className="w-full"
            animate
          />
        </div>
        <span
          aria-hidden
          className="text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-ink"
        >
          <Icon.arrowRight size={16} />
        </span>
      </div>

      {/* Mobile: stacked card */}
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Status kind={order.status} />
          <span className="num text-xs text-ink-3">
            {Math.round(currentOdds * 100)}% / {Math.round(order.threshold * 100)}%
          </span>
        </div>
        <div className="flex items-start gap-3">
          <Dial
            current={currentOdds}
            threshold={order.threshold}
            side={order.side}
            triggerOn="drop"
            size={44}
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-serif text-base leading-tight">{marketQuestion}</p>
            <p className="mt-1 text-xs text-ink-3">
              {order.nickname}
              {order.status === "waiting" &&
                ` · ${fmtPointsAway(currentOdds, order.threshold)} away`}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-2">
            <TokenLogo symbol={order.sellSymbol} logoURI={order.sellLogoURI} size={20} />
            <span className="num">
              {fmtNum(order.sellAmount, 2)} {order.sellSymbol}
            </span>
            <Icon.arrowRight size={10} className="text-ink-3" aria-hidden />
            <TokenLogo symbol={order.buySymbol} logoURI={order.buyLogoURI} size={20} />
            <span className="font-mono">{order.buySymbol}</span>
          </span>
        </div>
        <div className="overflow-hidden">
          <Tape
            data={sparkData}
            timestamps={sparkTimestamps}
            threshold={order.threshold}
            side={order.side}
            width={300}
            height={36}
            className="w-full"
            animate
          />
        </div>
      </div>
    </Link>
  );
}

/**
 * Sized to the real SwapRow grid so the swap-in causes no layout shift. Keeps
 * stable bits (status, token logos, amount) remain visible while the
 * market-dependent question, dial, chart and odds badge load.
 */
function SwapRowSkeleton({ href, order }: { href: string; order: OrderViewModel }) {
  return (
    <Link href={href} className="group block border-b border-rule-soft bg-paper hover:bg-paper-2">
      <div className="hidden items-center gap-4 px-6 py-4 lg:grid lg:grid-cols-[60px_1fr_180px_220px_28px]">
        <Shimmer className="h-12 w-12 rounded-full" />
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Shimmer className="h-5 w-64 max-w-full" />
            <Status kind={order.status} />
          </div>
          <Shimmer className="mt-2 h-3 w-40" />
        </div>
        <div className="flex items-center gap-2.5">
          <TokenLogo symbol={order.sellSymbol} logoURI={order.sellLogoURI} size={22} />
          <span className="num text-sm">
            {fmtNum(order.sellAmount, 2)} {order.sellSymbol}
          </span>
          <Icon.arrowRight size={12} className="text-ink-3" aria-hidden />
          <TokenLogo symbol={order.buySymbol} logoURI={order.buyLogoURI} size={22} />
        </div>
        <Shimmer className="h-10 w-full" />
        <span aria-hidden className="text-ink-3">
          <Icon.arrowRight size={16} />
        </span>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Status kind={order.status} />
          <Shimmer className="h-3 w-20" />
        </div>
        <div className="flex items-start gap-3">
          <Shimmer className="h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Shimmer className="h-9 w-full" />
            <Shimmer className="mt-2 h-3 w-28" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-2">
            <TokenLogo symbol={order.sellSymbol} logoURI={order.sellLogoURI} size={20} />
            <span className="num">
              {fmtNum(order.sellAmount, 2)} {order.sellSymbol}
            </span>
            <Icon.arrowRight size={10} className="text-ink-3" aria-hidden />
            <TokenLogo symbol={order.buySymbol} logoURI={order.buyLogoURI} size={20} />
            <span className="font-mono">{order.buySymbol}</span>
          </span>
        </div>
        <Shimmer className="h-9 w-full" />
      </div>
    </Link>
  );
}
