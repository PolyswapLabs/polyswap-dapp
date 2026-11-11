import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
process.env.RPC_URL = "http://127.0.0.1:1";
const { orderRepository } = await import("../../src/backend/db/orderRepository");
const { getPublicClient } = await import("../../src/backend/rpc/clients");
const { POST } = await import("../../src/app/api/polyswap/orders/id/[id]/notify-remove/route");

const OWNER = "0x1111111111111111111111111111111111111111";
const ORDER_HASH = `0x${"ab".repeat(32)}`;
const liveOrder = { id: 7, owner: OWNER, status: "live", order_hash: ORDER_HASH };

// The Safe may take far longer than any signing window to execute remove(), so the
// route must not depend on a signature: the on-chain read is the authorisation.
const notify = (body?: unknown) =>
  POST(
    new NextRequest("http://localhost/api/polyswap/orders/id/7/notify-remove", {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: "7" }) }
  );

function mockOrder(t: test.TestContext, order: object | null) {
  t.mock.method(orderRepository, "getPolyswapOrderById", async () => order);
  return t.mock.method(orderRepository, "updateOrderStatusById", async () => true);
}

function mockSingleOrderAuthed(t: test.TestContext, authed: unknown) {
  return t.mock.method(getPublicClient(), "readContract", async () => authed);
}

test("an order removed on-chain is canceled without a signature", async (t) => {
  const update = mockOrder(t, liveOrder);
  mockSingleOrderAuthed(t, false);

  const response = await notify();

  assert.equal(response.status, 200);
  assert.deepEqual(update.mock.calls[0]?.arguments, [7, "canceled"]);
});

test("a body from an older client is ignored", async (t) => {
  const update = mockOrder(t, liveOrder);
  mockSingleOrderAuthed(t, false);

  const response = await notify({ signature: "0xdead", timestamp: 0 });

  assert.equal(response.status, 200);
  assert.equal(update.mock.callCount(), 1);
});

test("an order still active on-chain is not canceled", async (t) => {
  const update = mockOrder(t, liveOrder);
  mockSingleOrderAuthed(t, true);

  const response = await notify();

  assert.equal(response.status, 409);
  assert.equal(update.mock.callCount(), 0);
});

test("an order the listener already canceled is reported as canceled", async (t) => {
  const update = mockOrder(t, { ...liveOrder, status: "canceled" });
  const read = mockSingleOrderAuthed(t, false);

  const response = await notify();

  assert.equal(response.status, 200);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
});

test("an order that is not live is rejected before reading the chain", async (t) => {
  const update = mockOrder(t, { ...liveOrder, status: "filled" });
  const read = mockSingleOrderAuthed(t, false);

  const response = await notify();

  assert.equal(response.status, 400);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
});

test("an unknown order is a 404", async (t) => {
  mockOrder(t, null);

  const response = await notify();

  assert.equal(response.status, 404);
});
