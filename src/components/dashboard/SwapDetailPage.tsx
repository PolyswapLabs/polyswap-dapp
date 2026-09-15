"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DetailSkeleton,
  Dial,
  Shimmer,
  Status,
  Tape,
  TokenLogo,
} from "@/components/primitives";
import { Icon, PolymarketIcon } from "@/components/icons";
import { fmtDate, fmtNum, fmtPointsAway } from "@/lib/format";
import { apiService } from "@/services/api";
import { useOrder } from "@/hooks/useOrders";
import { useMarket, useMarketPriceHistory } from "@/hooks/useMarketsData";
import { useRemoveOrder } from "@/hooks/useRemoveOrder";
import { useSignAction, type SignedAction } from "@/hooks/useSignAction";
import { SafeSignModal } from "@/components/modals/SafeSignModal";
import type { SafeCall } from "@/services/safe/types";
import { Timeline } from "./Timeline";

interface Props {
  orderId: string;
}

export function SwapDetailPage({ orderId }: Props) {
  const { order, isLoading, isError, errorMessage, walletConnected } = useOrder(orderId);
  const { address } = useAccount();
  // Real Polymarket history for the side the user picked (YES or NO).
  // Falls back to synthetic spark on the chart when unavailable (no marketId
  // yet, fetch in flight, or non-binary).
  const marketQ = useMarket(order?.marketId ?? "");
  const market = marketQ.data;
  const sideTokenId =
    order?.side === "NO" ? (market?.noTokenId ?? null) : (market?.yesTokenId ?? null);
  const historyQ = useMarketPriceHistory(sideTokenId, 60);
  const priceHistory = historyQ.data ?? [];
  const router = useRouter();
  const queryClient = useQueryClient();
  const { deleteDraft, buildRemoveLiveCalls, pending, error } = useRemoveOrder();
  const { signAction } = useSignAction();
  const [signOpen, setSignOpen] = useState(false);
  const [calls, setCalls] = useState<SafeCall[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Pre-tx signed `notify_remove` payload, captured during the modal's
  // `prepare` step and replayed in `onConfirmed` after the on-chain remove
  // confirms. Keeps the popup open across BOTH steps and avoids re-prompting
  // the user after the tx.
  const pendingNotifySigRef = useRef<SignedAction | null>(null);

  const cancellable = order?.phase === "draft" || order?.phase === "live";

  const handleCancelClick = async () => {
    setLocalError(null);
    if (!order) return;
    if (order.phase === "draft") {
      try {
        await deleteDraft(order.numericId);
        queryClient.invalidateQueries({ queryKey: ["orders", address] });
        router.push("/dashboard");
      } catch {
        // error surfaced via hook state
      }
      return;
    }
    if (order.phase === "live") {
      if (!order.orderHash) {
        setLocalError("Order hash not yet available — please retry in a moment.");
        return;
      }
      setCalls(buildRemoveLiveCalls(order.orderHash));
      setSignOpen(true);
    }
  };

  const onConfirmed = async () => {
    if (!order) return;
    const numericId = order.numericId;
    const signed = pendingNotifySigRef.current;
    if (!signed) {
      // Shouldn't happen: prepare must run before send. Surface defensively.
      setLocalError("Missing confirmation signature — please retry the cancel.");
      setSignOpen(false);
      setCalls(null);
      return;
    }
    try {
      await apiService.notifyRemoveOrder(numericId, signed.signature, signed.timestamp);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to finalise cancel");
      setSignOpen(false);
      setCalls(null);
      pendingNotifySigRef.current = null;
      return;
    }
    pendingNotifySigRef.current = null;
    queryClient.invalidateQueries({ queryKey: ["orders", address] });
    setSignOpen(false);
    setCalls(null);
    router.push("/dashboard");
  };

  const prepareCancel = useCallback(async () => {
    if (!order) throw new Error("No order to cancel");
    const signed = await signAction("notify_remove", String(order.numericId));
    pendingNotifySigRef.current = signed;
  }, [order, signAction]);

  const cancelSummary = useMemo(
    () => (order ? <>Cancel &ldquo;{order.nickname}&rdquo;</> : null),
    [order]
  );

  if (!walletConnected) {
    return (
      <div className="py-16 text-center text-sm text-ink-3">
        Connect your wallet to view this swap.
      </div>
    );
  }

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (isError || !order) {
    return (
      <div className="py-16 text-center text-sm text-ink-3">
        {isError
          ? `We couldn't load that swap. ${errorMessage ?? ""}`
          : "We couldn't find that swap."}{" "}
        <Link href="/dashboard" className="underline">
          Back to my swaps
        </Link>
        .
      </div>
    );
  }

  // While the per-market queries are still in flight for an order with a
  // marketId, painting `order.spark` (a synthetic placeholder curve) plus a
  // 0% odds badge would visibly swap to real data a moment later. Hold the
  // tracker in a skeleton state until both queries resolve.
  const expectingRealData = order.marketId !== null;
  const trackerPending =
    expectingRealData &&
    (marketQ.isPending ||
      historyQ.isPending ||
      (market !== undefined &&
        sideTokenId !== null &&
        historyQ.isFetching &&
        priceHistory.length === 0));

  // Prefer real CLOB history; fall back to the synthetic spark when none yet.
  const useRealHistory = priceHistory.length >= 2;
  const chartData = useRealHistory ? priceHistory.map((p) => p.p) : order.spark;
  const chartTimestamps = useRealHistory ? priceHistory.map((p) => p.t) : undefined;
  const currentOdds = chartData[chartData.length - 1] ?? 0;
  const isFilled = order.phase === "filled";
  // Polyswap places a BUY limit at `threshold` on Polymarket, which fills only
  // when the side's price falls to that level. So the threshold is "met" when
  // the live odds drop to or below the line — the inverse of the old logic.
  const thresholdMet = currentOdds <= order.threshold;
  // Right-of-dial label, in priority order: filled fill → trigger fired
  // (gate opened on-chain) → threshold met (market past the line, gate not
  // yet observed) → live distance to threshold.
  const distanceLabel = isFilled
    ? "Filled"
    : order.gateOpenedAt
      ? "Trigger fired"
      : thresholdMet
        ? "Threshold met"
        : `${fmtPointsAway(currentOdds, order.threshold)} until trigger`;

  const high = Math.max(...chartData);
  const low = Math.min(...chartData);

  const executedAtSec = order.filledAt ? order.filledAt.getTime() / 1000 : undefined;
  const marketQuestion = market?.question;

  return (
    <div className="space-y-8 py-8 lg:py-10">
      <div className="border-b border-ink pb-6 lg:pb-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink"
        >
          <Icon.arrowLeft size={12} aria-hidden /> Back to my swaps
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              {expectingRealData && marketQ.isPending ? (
                <Shimmer className="h-16 max-w-3xl flex-1 sm:h-20" />
              ) : (
                <h1 className="max-w-4xl text-balance font-serif text-2xl leading-tight sm:text-3xl lg:text-[40px]">
                  {marketQuestion ?? order.nickname}
                </h1>
              )}
              <span className="mt-1 shrink-0">
                <Status
                  kind={order.status}
                  className="min-h-8 px-3 text-xs sm:min-h-9 sm:px-4 sm:text-[13px]"
                />
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-3 sm:text-sm">
              {marketQuestion ? <>{order.nickname} · </> : null}
              <span className="num">
                {fmtNum(order.sellAmount, 2)} {order.sellSymbol}
              </span>{" "}
              · expires {fmtDate(order.endTime)}
            </p>
            {order.phase === "errored" && order.lastErrorReason && (
              <p className="mt-2 border border-no bg-no/10 px-3 py-2 text-xs text-no">
                Errored: {order.lastErrorReason}
              </p>
            )}
            {order.phase === "live" && order.lastErrorReason && (
              <p className="mt-2 text-xs text-ink-3">
                Waiting: {order.lastErrorReason}
                {order.lastErrorRetryAt &&
                  order.lastErrorRetryAt > Math.floor(Date.now() / 1000) && (
                    <> · retry around {new Date(order.lastErrorRetryAt * 1000).toLocaleString()}</>
                  )}
              </p>
            )}
          </div>
          {cancellable && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="ink"
                size="md"
                disabled={pending}
                onClick={() => void handleCancelClick()}
              >
                <Icon.trash size={14} aria-hidden />
                {pending ? "Cancelling…" : "Cancel swap"}
              </Button>
              {(localError ?? error) && <p className="text-xs text-no">{localError ?? error}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-8 lg:col-span-8">
          {/* Tracker */}
          <section aria-label="Tracker" className="border border-ink bg-paper p-4 sm:p-6">
            {trackerPending ? (
              <TrackerSkeleton threshold={order.threshold} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-5">
                  <Dial
                    current={currentOdds}
                    threshold={order.threshold}
                    side={order.side}
                    triggerOn="drop"
                    size={88}
                    animate
                  />
                  <div className="min-w-0 flex-1">
                    <p className="num text-3xl font-semibold lg:text-4xl">
                      {Math.round(currentOdds * 100)}%
                    </p>
                    <p className="text-sm text-ink-3">
                      Today · trigger at {Math.round(order.threshold * 100)}%
                    </p>
                  </div>
                  <p className="num shrink-0 border border-ink bg-paper-2 px-3 py-2 text-sm">
                    {distanceLabel}
                  </p>
                </div>

                {/* Vertical padding on top is generous so the execution-marker
                    icon (which floats above the chart top) isn't clipped by the
                    outer card. We deliberately don't use overflow-hidden here. */}
                <div className="mt-5 flex gap-3 border border-rule-soft bg-paper-2 px-3 pb-3 pt-7">
                  <div className="num flex shrink-0 flex-col justify-between py-1 text-[11px] text-ink-3">
                    <span>100%</span>
                    <span>75%</span>
                    <span>50%</span>
                    <span>25%</span>
                    <span>0%</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Tape
                      data={chartData}
                      timestamps={chartTimestamps}
                      executedAt={executedAtSec}
                      threshold={order.threshold}
                      side={order.side}
                      width={760}
                      height={200}
                      className="w-full"
                      animate
                      interactive
                    />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 border border-ink">
                  <Stat label="High" value={`${Math.round(high * 100)}%`} />
                  <Stat label="Low" value={`${Math.round(low * 100)}%`} />
                  <Stat
                    label="Time waiting"
                    value={`${Math.max(0, Math.floor((Date.now() - order.startTime.getTime()) / 86_400_000))}d`}
                  />
                </div>
              </>
            )}
          </section>

          {/* Timeline */}
          <section aria-label="Timeline">
            <p className="eyebrow mb-4">What&rsquo;s happened</p>
            <div className="border border-ink bg-paper p-5 lg:p-6">
              <Timeline order={order} />
            </div>
          </section>
        </div>

        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-6 lg:space-y-5">
            <section aria-label="The deal" className="border border-ink bg-paper-2 p-5">
              <p className="eyebrow mb-3">The deal</p>
              <div className="grid grid-cols-[28px_1fr] items-center gap-x-3 gap-y-2">
                <TokenLogo symbol={order.sellSymbol} logoURI={order.sellLogoURI} size={28} />
                <span className="num text-lg">
                  {isFilled
                    ? fmtNum(order.actualSellAmount ?? order.sellAmount, 2)
                    : fmtNum(order.sellAmount, 2)}{" "}
                  {order.sellSymbol}
                </span>
                <span className="flex justify-center" aria-hidden>
                  <Icon.arrowDown size={14} className="text-ink-3" />
                </span>
                <span aria-hidden />
                <TokenLogo symbol={order.buySymbol} logoURI={order.buyLogoURI} size={28} />
                <span className="num text-lg">
                  {isFilled && order.actualBuyAmount !== null
                    ? `${fmtNum(order.actualBuyAmount, 6)} ${order.buySymbol}`
                    : order.buySymbol}
                </span>
              </div>
              {isFilled && order.actualBuyAmount !== null && order.actualSellAmount !== null && (
                <p className="mt-3 text-xs text-ink-3">
                  Filled at{" "}
                  <span className="num text-ink-2">
                    1 {order.sellSymbol} ={" "}
                    {fmtNum(order.actualBuyAmount / order.actualSellAmount, 6)} {order.buySymbol}
                  </span>
                </p>
              )}
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-rule-soft pt-3 text-xs">
                <Row k="Trigger" v={`${order.side} ≃ ${Math.round(order.threshold * 100)}%`} />
                <Row k="Created" v={fmtDate(order.startTime)} />
                <Row k="Expires" v={fmtDate(order.endTime)} />
              </dl>
            </section>

            {market && (
              <section aria-label="Market" className="border border-ink bg-paper p-5">
                <p className="eyebrow mb-3">Market</p>
                <a
                  href={`https://polymarket.com/event/${market.eventSlug ?? market.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 text-sm hover:underline"
                >
                  <PolymarketIcon size={16} className="text-ink" />
                  View on Polymarket
                  <Icon.arrowUpRight
                    size={12}
                    className="text-ink-3 transition-colors group-hover:text-ink"
                    aria-hidden
                  />
                </a>
              </section>
            )}

            <section aria-label="Tracking" className="border border-ink bg-paper p-5">
              <p className="eyebrow mb-3">CoW order</p>
              {isFilled && order.orderUid ? (
                <a
                  href={`https://explorer.cow.fi/pol/orders/${order.orderUid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 text-sm hover:underline"
                >
                  View on CoW Explorer
                  <Icon.arrowUpRight
                    size={12}
                    className="text-ink-3 transition-colors group-hover:text-ink"
                    aria-hidden
                  />
                </a>
              ) : address ? (
                <a
                  href={`https://explorer.cow.fi/pol/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 text-sm hover:underline"
                >
                  See this wallet&apos;s orders on CoW Explorer
                  <Icon.arrowUpRight
                    size={12}
                    className="text-ink-3 transition-colors group-hover:text-ink"
                    aria-hidden
                  />
                </a>
              ) : (
                <p className="text-sm text-ink-3">
                  Order will appear on CoW Explorer once the watch-tower picks it up.
                </p>
              )}
              <p className="mt-2 text-xs text-ink-3">
                {isFilled
                  ? "Includes the actual fill price and the on-chain settlement."
                  : order.gateOpenedAt
                    ? "Trigger fired — waiting on the swap to settle."
                    : "Will appear here once the trigger fires and the swap settles."}
              </p>
            </section>
          </div>
        </aside>
      </div>

      {calls && (
        <SafeSignModal
          open={signOpen}
          onClose={() => {
            setSignOpen(false);
            setCalls(null);
            pendingNotifySigRef.current = null;
          }}
          calls={calls}
          onConfirmed={() => void onConfirmed()}
          summary={cancelSummary}
          prepare={{
            run: prepareCancel,
            heading: "Confirm cancel in your wallet",
            body: "Sign the off-chain message authorising this cancel. Then return here to open the on-chain remove transaction.",
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-ink p-3 text-center last:border-r-0 sm:p-4">
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 text-base font-semibold sm:text-lg">{value}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right font-mono tabular-nums">{v}</dd>
    </>
  );
}

/**
 * Sized to the real Tracker so the swap-in causes no layout shift. The
 * trigger threshold caption is preserved (it's known from the order itself);
 * the data-dependent bits — current odds, distance label, chart, high/low —
 * shimmer until the per-market queries resolve.
 */
function TrackerSkeleton({ threshold }: { threshold: number }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-5">
        <Shimmer className="h-[88px] w-[88px] rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Shimmer className="h-9 w-24" />
          <p className="text-sm text-ink-3">Today · trigger at {Math.round(threshold * 100)}%</p>
        </div>
        <Shimmer className="h-9 w-32 shrink-0" />
      </div>

      <div className="mt-5 flex gap-3 border border-rule-soft bg-paper-2 px-3 pb-3 pt-7">
        <div className="num flex shrink-0 flex-col justify-between py-1 text-[11px] text-ink-3">
          <span>100%</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>
        <div className="min-w-0 flex-1">
          <Shimmer className="h-[200px] w-full" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 border border-ink">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-r border-ink p-3 text-center last:border-r-0 sm:p-4">
            <Shimmer className="mx-auto h-3 w-12" />
            <Shimmer className="mx-auto mt-2 h-5 w-10" />
          </div>
        ))}
      </div>
    </>
  );
}
