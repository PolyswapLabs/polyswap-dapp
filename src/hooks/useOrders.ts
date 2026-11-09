"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Hex } from "viem";
import { apiService } from "@/services/api";
import type { PublicPolyswapOrder } from "@/backend/interfaces/PolyswapOrder";
import type { SwapStatus } from "@/types/design";
import { useTokens, type Token } from "@/hooks/useTokens";

export interface OrderViewModel {
  id: string;
  numericId: number;
  status: SwapStatus;
  nickname: string;
  marketId: string | null;
  /** YES/NO side the user picked when creating the order. */
  side: "YES" | "NO";
  sellSymbol: string;
  buySymbol: string;
  sellLogoURI?: string;
  buyLogoURI?: string;
  sellAmount: number;
  startTime: Date;
  endTime: Date;
  /** Synthetic spark — replaced by real history when available. */
  spark: number[];
  /** Threshold used for visual feedback. */
  threshold: number;
  /** Underlying DB lifecycle status — used by cancel logic (off-chain delete vs. on-chain remove). */
  phase: "draft" | "live" | "filled" | "canceled" | "errored" | "expired";
  /** On-chain order hash, populated once the listener observes ConditionalOrderCreated. Null while draft. */
  orderHash: Hex | null;
  /** CoW Protocol order UID (bytes56). Null until the watch-tower has registered the order with CoW. */
  orderUid: string | null;
  /** Human-readable reason emitted alongside the conditional-order revert. */
  lastErrorReason: string | null;
  /**
   * Block number (PollTryAtBlock) or epoch seconds (PollTryAtEpoch) the order
   * said to retry at. Null for terminal / next-block variants.
   */
  lastErrorRetryAt: number | null;
  /** Set by the listener once the on-chain Trade event for this order is observed. */
  filledAt: Date | null;
  /**
   * First moment the conditional gate was observed open (i.e. Polymarket
   * condition fired). Lets the UI distinguish "still waiting for trigger"
   * (gate closed) from "trigger fired, waiting for swap to settle"
   * (gate open, fill not in yet).
   */
  gateOpenedAt: Date | null;
  /** Real sell amount as filled on-chain, in human units (sellToken decimals). Null until filled. */
  actualSellAmount: number | null;
  /** Real buy amount as filled on-chain, in human units (buyToken decimals). Null until filled. */
  actualBuyAmount: number | null;
}

const STALE = 30_000;

export const ordersQueryKey = (owner: string | undefined) => ["orders", owner] as const;

function mapStatus(order: Pick<PublicPolyswapOrder, "status" | "gate_opened_at">): SwapStatus {
  switch (order.status) {
    case "filled":
      return "done";
    case "canceled":
      return "cancelled";
    case "errored":
      return "cancelled";
    case "expired":
      return "expired";
    case "live":
      return order.gate_opened_at ? "ready" : "waiting";
    case "draft":
      return "waiting";
  }
}

/**
 * Action-sentence nickname: `Buy {BUY} if {SIDE} ≃ {pct}%`. Used as the H1 on
 * the order detail page and the row title on the My Swaps list — readable at
 * a glance without needing the market title (which lives in its own panel).
 */
function shortNickname(buy: string, outcome: string | null, betPercentage: number | null): string {
  const side = outcome ? outcome.toUpperCase() : "YES";
  const pct = betPercentage !== null ? Math.round(betPercentage) : 0;
  return `Buy ${buy} if ${side} ≃ ${pct}%`;
}

function syntheticSpark(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  let v = 0.4 + (Math.abs(h) % 30) / 100;
  for (let i = 0; i < 60; i++) {
    h = (h * 9301 + 49297) | 0;
    v = Math.max(0.05, Math.min(0.95, v + ((h % 1000) / 1000 - 0.5) * 0.05));
    out.push(v);
  }
  return out;
}

function buildTokenMap(tokens: Token[] | undefined): Map<string, Token> {
  const map = new Map<string, Token>();
  for (const t of tokens ?? []) map.set(t.address.toLowerCase(), t);
  return map;
}

export function toOrderView(o: PublicPolyswapOrder, tokenMap: Map<string, Token>): OrderViewModel {
  const sellMeta = tokenMap.get(o.sell_token.toLowerCase());
  const buyMeta = tokenMap.get(o.buy_token.toLowerCase());
  const sellSym = sellMeta?.symbol ?? "?";
  const buySym = buyMeta?.symbol ?? "?";
  const sellDecimals = sellMeta?.decimals ?? 18;
  const buyDecimals = buyMeta?.decimals ?? 18;
  return {
    id: String(o.id),
    numericId: o.id,
    status: mapStatus(o),
    nickname: shortNickname(buySym, o.outcome_selected, o.bet_percentage),
    marketId: o.market_id ? String(o.market_id) : null,
    side: o.outcome_selected?.toLowerCase() === "no" ? "NO" : "YES",
    sellSymbol: sellSym,
    buySymbol: buySym,
    sellLogoURI: sellMeta?.logoURI,
    buyLogoURI: buyMeta?.logoURI,
    sellAmount: Number(BigInt(o.sell_amount)) / 10 ** sellDecimals,
    startTime: new Date(o.start_time),
    endTime: new Date(o.end_time),
    spark: syntheticSpark(String(o.id)),
    // bet_percentage is stored as 0..100 (% trigger). Fall back to 0.7 only
    // for legacy rows that pre-date the column being persisted.
    threshold:
      o.bet_percentage !== null && o.bet_percentage !== undefined ? o.bet_percentage / 100 : 0.7,
    phase: o.status,
    orderHash: o.order_hash ? (o.order_hash as Hex) : null,
    orderUid: o.order_uid ?? null,
    lastErrorReason: o.last_error_reason ?? null,
    lastErrorRetryAt:
      o.last_error_retry_at !== null && o.last_error_retry_at !== undefined
        ? Number(o.last_error_retry_at)
        : null,
    filledAt: o.filled_at ? new Date(o.filled_at) : null,
    gateOpenedAt: o.gate_opened_at ? new Date(o.gate_opened_at) : null,
    actualSellAmount:
      o.actual_sell_amount !== null
        ? Number(BigInt(o.actual_sell_amount)) / 10 ** sellDecimals
        : null,
    actualBuyAmount:
      o.actual_buy_amount !== null ? Number(BigInt(o.actual_buy_amount)) / 10 ** buyDecimals : null,
  };
}

interface UseOrdersResult {
  orders: OrderViewModel[];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  walletConnected: boolean;
}

export function useOrders(): UseOrdersResult {
  const { address, isConnected } = useAccount();
  const tokensQ = useTokens();

  const query = useQuery({
    queryKey: ordersQueryKey(address),
    queryFn: async () => {
      if (!address) return [];
      const res = await apiService.getOrdersByOwner(address);
      if (!res.success || !res.data) return [];
      return res.data;
    },
    enabled: Boolean(address),
    staleTime: STALE,
  });

  const tokenMap = buildTokenMap(tokensQ.data);

  // We don't fetch market titles inline — they're optional and the row still
  // renders without them. A follow-up could batch market lookups by id.
  const orders = (query.data ?? []).map((o) => toOrderView(o, tokenMap));

  return {
    orders,
    isLoading: query.isLoading || tokensQ.isLoading,
    isError: query.isError || tokensQ.isError,
    errorMessage:
      query.error instanceof Error
        ? query.error.message
        : tokensQ.error instanceof Error
          ? tokensQ.error.message
          : null,
    walletConnected: isConnected,
  };
}

export function useOrder(orderId: string): {
  order: OrderViewModel | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  walletConnected: boolean;
} {
  const { orders, isLoading, isError, errorMessage, walletConnected } = useOrders();
  const order = orders.find((o) => o.id === orderId) ?? null;
  return { order, isLoading, isError, errorMessage, walletConnected };
}
