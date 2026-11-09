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
