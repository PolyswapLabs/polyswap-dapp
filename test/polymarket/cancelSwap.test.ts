import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";
import composableCowAbi from "../../src/abi/composableCoW.json";
import { getOrderById } from "../../src/client/api/polyswapApi";
import { planCancel, removeOrderCalls } from "../../src/client/orders/cancelSwap";
import { DRAFT_POLL_MS, ordersRefetchInterval } from "../../src/client/orders/draftPolling";
import { COMPOSABLE_COW } from "../../src/shared/contracts";

const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001";

test("a live order is removed on-chain through the Safe", () => {
  assert.deepEqual(planCancel({ status: "live", order_hash: HASH }), {
    kind: "remove_on_chain",
    orderHash: HASH,
  });
});

test("a draft cannot be cancelled until its Safe transaction is confirmed", () => {
  assert.deepEqual(planCancel({ status: "draft", order_hash: HASH }), { kind: "confirming" });
});

test("a live order whose hash is not recorded yet is still confirming", () => {
  assert.deepEqual(planCancel({ status: "live", order_hash: null }), { kind: "confirming" });
});

test("an order that already settled is not cancelled again", () => {
  assert.deepEqual(planCancel({ status: "filled", order_hash: HASH }), {
    kind: "final",
    status: "filled",
  });
});

test("an order the server no longer has is reported as gone", () => {
  assert.deepEqual(planCancel(null), { kind: "gone" });
});

test("the removal is a single ComposableCoW.remove(orderHash) call", () => {
  const [call, ...rest] = removeOrderCalls(HASH);

  assert.equal(rest.length, 0);
  assert.equal(call?.to, COMPOSABLE_COW);
  assert.equal(call?.value, 0n);
  assert.ok(call?.data, "the call carries calldata");
  const decoded = decodeFunctionData({ abi: composableCowAbi, data: call.data });
  assert.equal(decoded.functionName, "remove");
  assert.deepEqual(decoded.args, [HASH]);
});

test("an order is read fresh from the server by id", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ success: true, data: { id: 7, status: "live", order_hash: HASH } })
  );

  const order = await getOrderById(7);

  const [url, init] = fetchMock.mock.calls[0]?.arguments ?? [];
  assert.equal(url, "/api/polyswap/orders/id/7");
  assert.equal((init as RequestInit).cache, "no-store");
  assert.equal(order?.status, "live");
});

test("an order the server cannot find reads as null", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ success: false, error: "Order not found" }, { status: 404 })
  );

  assert.equal(await getOrderById(7), null);
});

test("orders are polled only while one of them is a draft", () => {
  assert.equal(ordersRefetchInterval([{ status: "live" }, { status: "draft" }]), DRAFT_POLL_MS);
  assert.equal(ordersRefetchInterval([{ status: "live" }, { status: "filled" }]), false);
  assert.equal(ordersRefetchInterval(undefined), false);
});
