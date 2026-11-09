import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import {
  EXPIRY_OPTIONS,
  buildSafeCalls,
  computeMinBuyAmount,
  deadlineFromExpiry,
  expiryRecapLabel,
  toSafeCall,
  toWei,
} from "../../src/lib/createOrder";

const tx = (to: string, value = "0") => ({ to: to as Address, data: "0x01" as Hex, value });

test("toSafeCall converts the decimal value and treats an empty one as zero", () => {
  assert.deepEqual(toSafeCall(tx("0xa", "12")), { to: "0xa", data: "0x01", value: 12n });
  assert.equal(toSafeCall(tx("0xa", "")).value, 0n);
});

test("toWei keeps six decimals of precision before scaling", () => {
  assert.equal(toWei("1.5", 18), "1500000000000000000");
  assert.equal(toWei("1.23456789", 18), "1234568000000000000");
  assert.equal(toWei("0", 18), "0");
  assert.equal(toWei("abc", 18), "0");
});

test("computeMinBuyAmount uses 1 wei for auto or unusable estimates", () => {
  assert.equal(computeMinBuyAmount("auto", 10, 18), "1");
  assert.equal(computeMinBuyAmount(1, 0, 18), "1");
  assert.equal(computeMinBuyAmount(1, Number.NaN, 18), "1");
  assert.equal(computeMinBuyAmount(100, 10, 18), "1");
});

test("computeMinBuyAmount applies the slippage to the estimate", () => {
  assert.equal(computeMinBuyAmount(1, 1.5, 6), "1485000");
  assert.equal(computeMinBuyAmount(0.5, 100, 18), "99500000000000000000");
});

test("computeMinBuyAmount never rounds a positive floor down to zero", () => {
  assert.equal(computeMinBuyAmount(1, 1e-9, 18), "1");
  assert.equal(computeMinBuyAmount(1, 0.4, 0), "1");
});

test("deadlineFromExpiry sends a deadline only for fixed durations", () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(deadlineFromExpiry("7d", now), "2026-01-08T00:00:00.000Z");
  assert.equal(deadlineFromExpiry("30d", now), "2026-01-31T00:00:00.000Z");
  assert.equal(deadlineFromExpiry("until-resolution", now), undefined);
});

test("expiry options keep their display order and recap wording", () => {
  assert.deepEqual(
    EXPIRY_OPTIONS.map((o) => o.label),
    ["7 days", "30 days", "Until market resolves"]
  );
  assert.equal(expiryRecapLabel("7d"), "in 7 days");
  assert.equal(expiryRecapLabel("30d"), "in 30 days");
  assert.equal(expiryRecapLabel("until-resolution"), "when the market resolves");
});

const order = {
  sellAmount: "100",
  tx: tx("0xcreate"),
  batchTx: [tx("0xapprove"), tx("0xcreate")],
};

test("buildSafeCalls skips the approve when the allowance covers the sell amount", () => {
  assert.deepEqual(
    buildSafeCalls(order, 100n).map((c) => c.to),
    ["0xcreate"]
  );
});

test("buildSafeCalls keeps the approve when the allowance is short", () => {
  assert.deepEqual(
    buildSafeCalls(order, 99n).map((c) => c.to),
    ["0xapprove", "0xcreate"]
  );
});

test("buildSafeCalls runs the fallback handler setup first", () => {
  assert.deepEqual(
    buildSafeCalls({ ...order, fallbackSetupTx: tx("0xfallback") }, 100n).map((c) => c.to),
    ["0xfallback", "0xcreate"]
  );
});
