import { formatPercent } from "@/utils/format";
import { suggestedThresholdPercent, type PostOnlyBuyCheck } from "@/shared/orders/postOnly";
import type { Side } from "@/shared/markets/categories";

const QUOTE_ERROR_COPY: Record<string, string> = {
  NoLiquidity: "No liquidity for this pair right now. Pick a different pair.",
  UnsupportedToken: "CoW Protocol doesn't support one of these tokens. Pick a different pair.",
  SellAmountDoesNotCoverFee:
    "The amount is too small to cover network fees. Increase it and try again.",
  InsufficientBalance: "Your wallet doesn't hold enough of the send token for this swap.",
  InsufficientAllowance: "Token allowance is too low. Approve the spender and retry.",
};

/** User-facing wording for a CoW quote failure. Unknown types use the API's own message. */
export function formatQuoteError(errorType: string | null, message: string | null): string {
  return (
    (errorType !== null ? QUOTE_ERROR_COPY[errorType] : undefined) ??
    message ??
    "Quote unavailable for this pair."
  );
}

/** Explains what the chosen threshold will do, given the live order book. */
export function describePostOnlyStatus(
  postOnlyEnabled: boolean,
  check: PostOnlyBuyCheck,
  side: Side,
  threshold: number
): string {
  if (!postOnlyEnabled) {
    return "Immediate execution is on, so this swap can fire as soon as it's confirmed.";
  }
  if (check.status === "crosses") {
    return `${side} is already at ${formatPercent(check.bestAsk)}, so a ${formatPercent(threshold)} trigger would fire immediately. Pick ${suggestedThresholdPercent(check)}% or lower.`;
  }
  if (check.status === "unavailable") {
    return "The Polymarket order book is unavailable, so we can't confirm this swap will wait.";
  }
  const fires = `The swap fires if ${side} drops to ${formatPercent(threshold)}.`;
  return check.bestAsk === null
    ? `Nobody is selling ${side} right now. ${fires}`
    : `${side} is at ${formatPercent(check.bestAsk)} right now. ${fires}`;
}
