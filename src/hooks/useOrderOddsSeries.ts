"use client";

import { useMarket, useMarketPriceHistory } from "@/hooks/useMarketsData";
import type { OrderViewModel } from "@/hooks/useOrders";

const HISTORY_DAYS = 60;

export type OrderOddsSeries = ReturnType<typeof useOrderOddsSeries>;

/**
 * Real Polymarket history for the side the order picked. React Query dedups
 * across orders sharing a market and token, so calling this per row is cheap.
 * Falls back to the order's synthetic spark when no real history exists.
 */
export function useOrderOddsSeries(order: OrderViewModel | null) {
  const marketQ = useMarket(order?.marketId ?? "");
  const market = marketQ.data;
  const sideTokenId =
    order?.side === "NO" ? (market?.noTokenId ?? null) : (market?.yesTokenId ?? null);
  const historyQ = useMarketPriceHistory(sideTokenId, HISTORY_DAYS);
  const priceHistory = historyQ.data ?? [];

  // While market/history load for an order with a marketId, painting the
  // synthetic spark and a 0% badge would visibly swap to real data a moment
  // later, so callers hold a skeleton until both queries resolve.
  const expectingRealData = order !== null && order.marketId !== null;
  const isMarketPending = expectingRealData && marketQ.isPending;
  const isPending =
    expectingRealData &&
    (marketQ.isPending ||
      historyQ.isPending ||
      (market !== undefined &&
        sideTokenId !== null &&
        historyQ.isFetching &&
        priceHistory.length === 0));

  const hasRealHistory = priceHistory.length >= 2;
  const odds = hasRealHistory ? priceHistory.map((p) => p.p) : (order?.spark ?? []);
  const timestamps = hasRealHistory ? priceHistory.map((p) => p.t) : undefined;

  return {
    market,
    isMarketPending,
    isPending,
    odds,
    timestamps,
    currentOdds: odds[odds.length - 1] ?? 0,
  };
}
