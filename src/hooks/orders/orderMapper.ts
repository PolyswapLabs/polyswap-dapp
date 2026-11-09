import type { Hex } from "viem";
import type { PublicPolyswapOrder } from "@/backend/interfaces/PolyswapOrder";
import type { SwapStatus } from "@/types/design";
import type { Token } from "@/hooks/useTokens";

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

function toTokenUnits(rawAmount: string, decimals: number): number {
  return Number(BigInt(rawAmount)) / 10 ** decimals;
}

export function buildTokenMap(tokens: Token[] | undefined): Map<string, Token> {
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
    sellAmount: toTokenUnits(o.sell_amount, sellDecimals),
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
      o.actual_sell_amount !== null ? toTokenUnits(o.actual_sell_amount, sellDecimals) : null,
    actualBuyAmount:
      o.actual_buy_amount !== null ? toTokenUnits(o.actual_buy_amount, buyDecimals) : null,
  };
}
