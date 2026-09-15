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
