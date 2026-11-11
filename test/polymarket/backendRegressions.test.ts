import assert from "node:assert/strict";
import { test } from "node:test";
import { PostHog } from "posthog-node";
import type { PolyswapOrderRow } from "../../src/backend/interfaces/PolyswapOrder";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
process.env.RPC_URL = "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "token";
process.env.NEXT_PUBLIC_POSTHOG_HOST = "http://127.0.0.1:1";

const { orderRepository } = await import("../../src/backend/db/orderRepository");
const { getPublicClient } = await import("../../src/backend/rpc/clients");
const { checkTradeability } = await import("../../src/backend/listener/cron/orderHealthCheck");
const { backfillOrderUids } = await import("../../src/backend/listener/startup/backfillOrderUids");
const { gammaApi } = await import("../../src/backend/polymarket/gamma");
const { getPostHogClient } = await import("../../src/server/posthog");

const ADDRESS = "0x1111111111111111111111111111111111111111";

const liveOrder = {
  id: 1,
  owner: ADDRESS,
  handler: ADDRESS,
  salt: `0x${"11".repeat(32)}`,
  sell_token: ADDRESS,
  buy_token: ADDRESS,
  sell_amount: "1",
  min_buy_amount: "1",
  start_time: new Date(1_000),
  end_time: new Date(Date.now() + 86_400_000),
  polymarket_order_hash: null,
  app_data: null,
  polymarket_maker_amount: null,
  explicit_deadline: true,
  market_id: null,
  sentinel_id: null,
  gate_opened_at: null,
} as unknown as PolyswapOrderRow;

test("a database failure after a tradeable read is not reported as an unrecognised revert", async (t) => {
  t.mock.method(getPublicClient(), "readContract", (async () => []) as never);
  t.mock.method(orderRepository, "clearOrderError", async () => {
    throw new Error("db down");
  });

  await assert.rejects(checkTradeability(liveOrder), /db down/);
});

for (const handler of [null, ""]) {
  test(`backfill skips an order with handler ${JSON.stringify(handler)}`, async (t) => {
    t.mock.method(orderRepository, "getLiveOrdersWithoutUid", (async () => [
      { ...liveOrder, order_hash: `0x${"22".repeat(32)}`, handler },
    ]) as never);
    const errors = t.mock.method(console, "error", () => undefined);

    await backfillOrderUids();

    assert.equal(errors.mock.callCount(), 0);
  });
}

test("every Gamma page request has a timeout, so a hung call cannot block all later syncs", async (t) => {
  const requests = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ events: [] }))
  );

  await gammaApi.getOpenMarkets({});

  assert.ok(requests.mock.callCount() > 0);
  for (const call of requests.mock.calls) {
    assert.ok((call.arguments[1] as RequestInit | undefined)?.signal instanceof AbortSignal);
  }
});

test("the market status lookup has a timeout", async (t) => {
  const requests = t.mock.method(globalThis, "fetch", async () => new Response("{}"));

  await gammaApi.isMarketClosed("1");

  assert.ok((requests.mock.calls[0]?.arguments[1] as RequestInit).signal instanceof AbortSignal);
});

test("server analytics stay off outside production, like the client's", () => {
  assert.equal(getPostHogClient() instanceof PostHog, false);
});
