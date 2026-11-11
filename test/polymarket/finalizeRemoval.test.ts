import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyRemoveOrder } from "../../src/client/api/polyswapApi";
import { finalizeRemoval } from "../../src/client/orders/finalizeRemoval";

const noWait = async () => undefined;
const stillActive = async (): Promise<void> => {
  throw new Error("Order is still active on-chain.");
};

test("finalising a removal asks the server without any wallet signature", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ success: true })
  );

  await notifyRemoveOrder(7);

  const [url, init] = fetchMock.mock.calls[0]?.arguments ?? [];
  assert.equal(url, "/api/polyswap/orders/id/7/notify-remove");
  assert.equal((init as RequestInit).method, "POST");
  assert.equal((init as RequestInit).body, undefined);
});

test("a removal the server records at once is canceled", async (t) => {
  const notify = t.mock.fn(async () => undefined);

  assert.equal(await finalizeRemoval(7, { notify, wait: noWait }), "canceled");
  assert.equal(notify.mock.callCount(), 1);
});

test("a removal the server's node does not see yet is retried", async (t) => {
  const notify = t.mock.fn(stillActive);
  notify.mock.mockImplementationOnce(stillActive, 0);
  notify.mock.mockImplementationOnce(async () => undefined, 1);
  const wait = t.mock.fn(noWait);

  assert.equal(await finalizeRemoval(7, { notify, wait, retryDelayMs: 2_000 }), "canceled");
  assert.equal(notify.mock.callCount(), 2);
  assert.deepEqual(wait.mock.calls[0]?.arguments, [2_000]);
});

test("a removal the server never records is left to the listener, without throwing", async (t) => {
  const notify = t.mock.fn(stillActive);

  assert.equal(await finalizeRemoval(7, { notify, wait: noWait, attempts: 3 }), "pending");
  assert.equal(notify.mock.callCount(), 3);
});
