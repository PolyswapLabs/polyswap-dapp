import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeImmediateFillSentence,
  describeTriggerSentence,
  type CreateFormState,
} from "../../src/hooks/useCreateOrderForm";

const state = {
  side: "YES",
  threshold: 0.7,
  fromToken: { symbol: "USDC" },
  toToken: { symbol: "WETH" },
  amountIn: "10",
  expiry: "7d",
  slippagePct: "auto",
} as unknown as CreateFormState;

test("the trigger sentence names the market and the swap", () => {
  assert.equal(
    describeTriggerSentence(state, "Will it rain?"),
    'If "Will it rain?" drops to 70%, swap 10 USDC for WETH.'
  );
});

test("the immediate-fill sentence warns that the order crosses the book", () => {
  assert.equal(
    describeImmediateFillSentence(state),
    "This 70% threshold crosses the live order book — the swap of 10 USDC for WETH would fire immediately."
  );
});

test("sentences fall back to placeholders for an incomplete form", () => {
  const blank = { ...state, fromToken: null, toToken: null, amountIn: "" };
  assert.equal(describeTriggerSentence(blank, "Q"), 'If "Q" drops to 70%, swap 0 — for —.');
});
