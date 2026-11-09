import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { DatabasePolymarketSentinel } from "../../src/backend/interfaces/PolyswapOrder";
import { account, sdkHarness } from "./fixtures";
import { PolymarketOrderService } from "../../src/backend/services/polymarketOrderService";

// Override before importing the DB module, even when this test is run directly.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { DatabaseService } = await import("../../src/backend/services/databaseService");
const { activateSentinel, getOrCreateSentinel } =
  await import("../../src/backend/services/polymarketSentinelService");

async function setup(t: TestContext) {
  const context = { protocolVersion: "v2" as const, negRisk: false };
  const h = await sdkHarness(context);
  const prepared = await h.service.prepareGTDOrder({
    ...context,
    tokenID: h.assetId,
    side: "BUY",
    price: 0.5,
    size: 5,
    expiration: Math.floor(Date.now() / 1000) + 3600,
    postOnly: true,
  });
  const row: DatabasePolymarketSentinel = {
    id: 1,
    market_id: "market",
    token_id: h.assetId,
    outcome_selected: "Yes",
    price_cents: 50,
    neg_risk: false,
    protocol_version: "v2",
    exchange_address: prepared.exchangeAddress,
    signed_order_format: prepared.signedOrderFormat,
    post_only: true,
    epoch: 1,
    polymarket_order_hash: prepared.polymarketOrderHash,
    polymarket_maker_amount: prepared.makerAmount,
    signed_order: prepared.signedOrder,
    expiration: new Date(prepared.expiration * 1000),
    status: "prepared",
    activation_tx_hash: null,
    last_error: null,
    activated_at: null,
    filled_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const previous = process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_V2;
  process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_V2 = account.address;
  t.after(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_V2;
    else process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_V2 = previous;
  });
  t.mock.method(PolymarketOrderService, "getInstance", () => h.service);
  t.mock.method(DatabaseService, "getSentinelById", async () => row);
  t.mock.method(DatabaseService, "claimSentinelActivation", async () => true);
  const live = t.mock.method(DatabaseService, "markSentinelLive", async () => undefined);
  const release = t.mock.method(
    DatabaseService,
    "releaseSentinelActivation",
    async () => undefined
  );
  const filled = t.mock.method(DatabaseService, "markSentinelFilled", async () => undefined);
  const authorization = {
    handler: account.address,
    polymarketOrderHash: prepared.polymarketOrderHash,
    makerAmount: prepared.makerAmount,
  };
  const posts = () => calls(h, "/order");
  return { ...h, row, prepared, live, release, filled, authorization, posts };
}

const calls = (h: { calls: Array<{ url: URL }> }, pathname: string) =>
  h.calls.filter((call) => call.url.pathname === pathname).length;

test("a sentinel Polymarket doesn't know yet is posted once and marked live", async (t) => {
  const h = await setup(t);
  await activateSentinel(1, "confirmed-tx", h.authorization);
  assert.equal(h.live.mock.callCount(), 1);
  assert.equal(h.release.mock.callCount(), 0);
  assert.equal(h.posts(), 1);
});

test("restart recovery recognizes an order resting on the book and never resubmits", async (t) => {
  const h = await setup(t);
  h.addOpenOrder(h.prepared.polymarketOrderHash);
  await activateSentinel(1, "confirmed-tx", h.authorization);
  assert.equal(h.live.mock.callCount(), 1);
  assert.equal(h.posts(), 0);
});

test("another open order on the account is not mistaken for this sentinel", async (t) => {
  const h = await setup(t);
  h.addOpenOrder(`0x${"cd".repeat(32)}`);
  await activateSentinel(1, "confirmed-tx", h.authorization);
  assert.equal(h.posts(), 1);
});

test("restart recovery recognizes a fully filled order on chain and never resubmits", async (t) => {
  const h = await setup(t);
  h.setStatus({ filled: true, remaining: 0n });
  await activateSentinel(1, "confirmed-tx", h.authorization);
  assert.equal(h.filled.mock.callCount(), 1);
  assert.equal(h.live.mock.callCount(), 0);
  assert.equal(h.posts(), 0);
});

test("restart recovery treats a partial fill past the gate as filled", async (t) => {
  const h = await setup(t);
  h.setStatus({ filled: false, remaining: (BigInt(h.prepared.makerAmount) * 9n) / 10n });
  await activateSentinel(1, "confirmed-tx", h.authorization);
  assert.equal(h.filled.mock.callCount(), 1);
  assert.equal(h.posts(), 0);
});

test("an outage is not mistaken for missing order and cannot trigger a duplicate submission", async (t) => {
  const h = await setup(t);
  h.failOpenOrders();
  await assert.rejects(activateSentinel(1, "confirmed-tx", h.authorization));
  assert.equal(h.release.mock.callCount(), 1);
  assert.equal(h.live.mock.callCount(), 0);
  assert.equal(h.posts(), 0);
});

test("a rejected post, such as a duplicate, leaves the sentinel to retry", async (t) => {
  const h = await setup(t);
  h.rejectOrders();
  await assert.rejects(activateSentinel(1, "confirmed-tx", h.authorization), /rejected/);
  assert.equal(h.release.mock.callCount(), 1);
  assert.equal(h.live.mock.callCount(), 0);
});

test("a mismatched Safe handler or committed amount cannot activate a sentinel", async (t) => {
  const h = await setup(t);
  await assert.rejects(
    activateSentinel(1, "tx", {
      ...h.authorization,
      handler: "0x0000000000000000000000000000000000000001",
    }),
    /commitments/
  );
  await assert.rejects(
    activateSentinel(1, "tx", { ...h.authorization, makerAmount: "1" }),
    /commitments/
  );
  assert.equal(h.calls.filter((call) => call.url.pathname === "/order").length, 0);
});

test("a partially filled sentinel whose gate is already open is not reused for a new authorization", async (t) => {
  const h = await setup(t);
  h.row.status = "live";
  h.setStatus({ filled: false, remaining: (BigInt(h.prepared.makerAmount) * 9n) / 10n });
  let searches = 0;
  t.mock.method(
    DatabaseService,
    "findReusableSentinel",
    async (input: Parameters<typeof DatabaseService.findReusableSentinel>[0]) => {
      assert.equal(input.protocolVersion, "v2");
      return searches++ === 0 ? h.row : null;
    }
  );
  t.mock.method(DatabaseService, "getNextSentinelEpoch", async () => 2);
  t.mock.method(h.service, "prepareGTDOrder", async () => h.prepared);
  t.mock.method(DatabaseService, "createPreparedSentinel", async () => ({
    ...h.row,
    id: 2,
    epoch: 2,
    status: "prepared",
  }));
  const next = await getOrCreateSentinel({
    marketId: "market",
    tokenId: h.assetId,
    outcomeSelected: "Yes",
    priceCents: 50,
    protocolVersion: "v2",
    negRisk: false,
    postOnly: true,
    expiration: h.row.expiration,
  });
  assert.equal(next.id, 2);
  assert.equal(next.epoch, 2);
});
