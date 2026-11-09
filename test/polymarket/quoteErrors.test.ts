import assert from "node:assert/strict";
import { test } from "node:test";
import { formatQuoteError } from "../../src/lib/quoteErrors";

test("known quote errors use the friendly wording, not the API message", () => {
  assert.equal(
    formatQuoteError("NoLiquidity", "raw detail"),
    "No liquidity for this pair right now. Pick a different pair."
  );
});

test("unknown quote errors fall back to the API message", () => {
  assert.equal(formatQuoteError("Weird", "raw detail"), "raw detail");
  assert.equal(formatQuoteError(null, "raw detail"), "raw detail");
});

test("a quote error without a message still explains itself", () => {
  assert.equal(formatQuoteError(null, null), "Quote unavailable for this pair.");
});
