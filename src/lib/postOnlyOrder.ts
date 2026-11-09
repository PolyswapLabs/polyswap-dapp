import { fmtPct } from "@/lib/format";
import type { Side } from "@/types/design";

export type PostOnlyBuyCheck =
  | { status: "rests"; bestAsk: number | null }
  | { status: "crosses"; bestAsk: number; suggestedMaxPrice: number }
  | { status: "unavailable" };

/**
 * A post-only BUY crosses whenever its limit is equal to or above the best ask.
 * Prices are probabilities in the [0, 1] range; the user limit is expressed in
 * integer cents so UI and API validation use the exact same rule.
 */
export function checkPostOnlyBuy(
  limitPriceCents: number,
  bestAsk: number | null | undefined,
  tickSize = 0.01
): PostOnlyBuyCheck {
  if (
    !Number.isInteger(limitPriceCents) ||
    limitPriceCents <= 0 ||
    limitPriceCents > 100 ||
    bestAsk === undefined ||
    (bestAsk !== null && (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk > 1))
  ) {
    return { status: "unavailable" };
  }

  // An empty ask side cannot be crossed by a BUY; the order can rest.
  if (bestAsk === null) return { status: "rests", bestAsk: null };

  const limitPrice = limitPriceCents / 100;
  if (limitPrice < bestAsk) return { status: "rests", bestAsk };

  return {
    status: "crosses",
    bestAsk,
    suggestedMaxPrice: Math.max(tickSize, bestAsk - tickSize),
  };
}

export function postOnlyCrossingMessage(check: Extract<PostOnlyBuyCheck, { status: "crosses" }>) {
  const bestAskPercent = Math.round(check.bestAsk * 100);
  const suggestedPercent = Math.floor(check.suggestedMaxPrice * 100 + Number.EPSILON);
  return `This threshold would fire immediately: the best available price is ${bestAskPercent}%. Choose ${suggestedPercent}% or less so the order can wait.`;
}

/** Explains what the chosen threshold will do, given the live order book. */
export function describePostOnlyStatus(
  postOnlyEnabled: boolean,
  check: PostOnlyBuyCheck,
  side: Side,
  threshold: number
): string {
  if (!postOnlyEnabled) {
    return "Immediate execution is enabled by the administrator. This order may fire as soon as it is confirmed.";
  }
  if (check.status === "crosses") return postOnlyCrossingMessage(check);
  if (check.status === "unavailable") {
    return "The live order book is unavailable, so we can't verify that this order will wait.";
  }
  const canWait = `Your ${fmtPct(threshold)} trigger can wait on the book.`;
  return check.bestAsk === null
    ? `There are no ${side} sell orders right now. ${canWait}`
    : `The best available ${side} price is ${fmtPct(check.bestAsk)}. ${canWait}`;
}
