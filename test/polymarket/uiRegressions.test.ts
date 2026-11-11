import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tape } from "../../src/components/charts/Tape";
import { RetryNote, SwapHeader } from "../../src/components/dashboard/SwapDetailSections";
import type { OrderViewModel } from "../../src/hooks/orders/orderMapper";
import { marketQueryOptions } from "../../src/hooks/markets/useMarkets";
import { statusForHash } from "../../src/hooks/safe/safeTxState";

// tsx compiles JSX with the classic runtime, which expects a global React.
Object.assign(globalThis, { React });

const endDotY = (data: number[]) => {
  const html = renderToStaticMarkup(createElement(Tape, { data } as never));
  return html.match(/cy="([^"]+)" r="2.5"/)?.[1];
};

test("the chart's end dot is clamped like its line", () => {
  assert.equal(endDotY([0.5, 1.4]), endDotY([0.5, 1]));
});

test("a retry timestamp of zero renders nothing", () => {
  assert.equal(renderToStaticMarkup(createElement(RetryNote, { retryAt: 0 })), "");
});

const draftOrder: OrderViewModel = {
  id: "7",
  numericId: 7,
  status: "waiting",
  nickname: "Buy USDT if YES ≃ 57%",
  marketId: null,
  side: "YES",
  sellSymbol: "USDC",
  buySymbol: "USDT",
  sellAmount: 1,
  startTime: new Date(0),
  endTime: new Date(0),
  spark: [],
  threshold: 0.57,
  phase: "draft",
  orderHash: null,
  orderUid: null,
  lastErrorReason: null,
  lastErrorRetryAt: null,
  filledAt: null,
  gateOpenedAt: null,
  actualSellAmount: null,
  actualBuyAmount: null,
};

const swapHeader = (confirming: boolean) =>
  renderToStaticMarkup(
    createElement(SwapHeader, {
      order: draftOrder,
      marketQuestion: "Will it happen?",
      isTitlePending: false,
      cancellable: true,
      confirming,
      cancelPending: false,
      cancelError: null,
      cancelNotice: null,
      onCancel: () => undefined,
    })
  );

test("a draft's cancel button stays locked until its Safe transaction confirms", () => {
  const html = swapHeader(true);
  assert.match(html, /<button[^>]*disabled=""[^>]*>.*Confirming on-chain…<\/button>/s);
  assert.doesNotMatch(html, /Cancel swap/);
});

test("a confirmed order's cancel button is enabled", () => {
  const html = swapHeader(false);
  assert.match(html, /Cancel swap/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("no market is requested for an order without a market id", () => {
  assert.equal(marketQueryOptions("").enabled, false);
});

test("a market is requested when there is an identifier", () => {
  assert.equal(marketQueryOptions("abc").enabled, true);
});

const HASH_A = `0x${"aa".repeat(32)}` as const;
const HASH_B = `0x${"bb".repeat(32)}` as const;
const executed = { kind: "executed", onChainHash: HASH_A } as const;

test("a transaction's status is reported for its own hash", () => {
  assert.deepEqual(statusForHash({ hash: HASH_A, status: executed }, HASH_A), executed);
});

test("a new transaction does not inherit the previous one's terminal status", () => {
  assert.deepEqual(statusForHash({ hash: HASH_A, status: executed }, HASH_B), { kind: "idle" });
});
