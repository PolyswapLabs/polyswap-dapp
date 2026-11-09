import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Log,
  type PublicClient,
} from "viem";

// Override before importing the DB module, even when this test is run directly.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";

const { getPolymarketContracts } = await import("../../src/backend/polymarket/config");
const { PolymarketDataClient } = await import("../../src/backend/polymarket/data");
const { PolymarketInventory } = await import("../../src/backend/polymarket/inventory");
const { DatabaseService } = await import("../../src/backend/services/databaseService");
const { PolymarketPositionSellerService: Seller } =
  await import("../../src/backend/services/polymarketPositionSellerService");
const { PolymarketOrderService } =
  await import("../../src/backend/services/polymarketOrderService");
const { subscribePositionReceipts, stopPositionSeller } =
  await import("../../src/backend/listener/cron/positionSeller");
const { handleTrade, handleLiveTrade } = await import("../../src/backend/listener/handlers/trade");

const OWNER = "0x92e53caa23ffc3bd4051cc5f0b56d9fb1d2a29e1";

const apiPosition = (tokenId: string, redeemable: boolean) => ({
  token_id: tokenId,
  condition_id: `0x${"ab".repeat(32)}`,
  current_size: "5",
  current_price: redeemable ? "0" : "0.5",
  title: "A market",
  outcome: "Yes",
  negative_risk: false,
  redeemable,
});

function fakeChain(scanned: bigint[] = []) {
  const reads: bigint[] = [];
  const client = {
    getBlockNumber: async () => 5000n,
    getLogs: async (args: { event: { name: string } }) =>
      args.event.name === "TransferSingle" ? scanned.map((id) => ({ args: { id } })) : [],
    readContract: async (args: { args: [string, bigint] }) => {
      reads.push(args.args[1]);
      return 1_000_000n;
    },
  } as unknown as PublicClient;
  return { client, reads };
}

const apiWith = (...rows: ReturnType<typeof apiPosition>[]) =>
  new PolymarketDataClient({
    fetch: async () => Response.json({ data: rows, pagination: { next_cursor: null } }),
  });

test("the seller's scan makes no balance calls for redeemable positions", async () => {
  const { client, reads } = fakeChain();
  const rows = await new PolymarketInventory(
    client,
    OWNER,
    apiWith(apiPosition("11", true), apiPosition("12", false))
  ).read({ skipRedeemable: true });

  assert.deepEqual([...new Set(reads)], [12n]);
  assert.deepEqual([...new Set(rows.map((row) => row.assetId))], ["12"]);
});

test("a redeemable position found by the transfer scan is skipped too", async () => {
  const { client, reads } = fakeChain([11n]);
  await new PolymarketInventory(client, OWNER, apiWith(apiPosition("11", true))).read({
    skipRedeemable: true,
  });

  assert.deepEqual(reads, []);
});

test("diagnostics still see redeemable positions by default", async () => {
  const { client } = fakeChain();
  const rows = await new PolymarketInventory(
    client,
    OWNER,
    apiWith(apiPosition("11", true))
  ).read();

  assert.deepEqual([...new Set(rows.map((row) => row.assetId))], ["11"]);
});

const TRADE = parseAbiItem(
  "event Trade(address indexed owner, address sellToken, address buyToken, uint256 sellAmount, uint256 buyAmount, uint256 feeAmount, bytes orderUid)"
);
const tradeLog = {
  topics: encodeEventTopics({
    abi: [TRADE],
    eventName: "Trade",
    args: { owner: "0x1111111111111111111111111111111111111111" },
  }),
  data: encodeAbiParameters(TRADE.inputs.slice(1), [
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
    1n,
    2n,
    0n,
    "0x1234",
  ]),
  transactionHash: `0x${"ab".repeat(32)}`,
  blockNumber: 1n,
  logIndex: 0,
} as unknown as Log;

function mockTrackedOrder(t: TestContext, tracked: boolean) {
  t.mock.method(DatabaseService, "getPolyswapOrderByUid", (async () =>
    tracked ? { id: 7 } : null) as never);
  return t.mock.method(DatabaseService, "updateOrderStatusById", (async () => true) as never);
}

test("someone else's CoW trade does not start a sell", async (t) => {
  const update = mockTrackedOrder(t, false);
  const sell = t.mock.fn(async () => {});

  await handleLiveTrade(tradeLog, sell);

  assert.equal(sell.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
});

test("my own CoW trade is recorded and then starts a sell", async (t) => {
  const update = mockTrackedOrder(t, true);
  const sell = t.mock.fn(async () => {});

  await handleLiveTrade(tradeLog, sell);

  assert.equal(update.mock.callCount(), 1);
  assert.equal(sell.mock.callCount(), 1);
});

test("a DB failure on a live trade is contained and starts no sell", async (t) => {
  t.mock.method(DatabaseService, "getPolyswapOrderByUid", (async () => {
    throw new Error("connection terminated");
  }) as never);
  const sell = t.mock.fn(async () => {});

  await assert.doesNotReject(handleLiveTrade(tradeLog, sell));

  assert.equal(sell.mock.callCount(), 0);
});

test("catch-up still sees a trade failure, so it cannot save a block past it", async (t) => {
  t.mock.method(DatabaseService, "getPolyswapOrderByUid", (async () => {
    throw new Error("connection terminated");
  }) as never);

  await assert.rejects(handleTrade(tradeLog), /connection terminated/);
});

type WatchArgs = {
  address: string[];
  event: { name: string };
  args: { to: string };
  onLogs: (logs: unknown[]) => void;
  onError: (error: Error) => void;
};

function startWatching(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(Seller, "getStatus", (() => ({ ownerAddress: OWNER })) as never);
  const sell = t.mock.method(Seller, "triggerSell", (async () => {}) as never);
  const unwatch = t.mock.fn();
  const subscriptions: WatchArgs[] = [];
  const ws = {
    watchEvent: (args: WatchArgs) => {
      subscriptions.push(args);
      return unwatch;
    },
  } as unknown as PublicClient;
  const onError = t.mock.fn();
  t.after(() => stopPositionSeller());
  return {
    sell,
    subscriptions,
    unwatch,
    onError,
    start: () => subscribePositionReceipts(ws, onError),
  };
}

test("shares reaching my wallet are watched on both ledgers, for both transfer kinds", (t) => {
  const { subscriptions, start } = startWatching(t);
  start();

  const { ctf, positionManager } = getPolymarketContracts();
  assert.deepEqual(subscriptions.map((sub) => sub.event.name).sort(), [
    "TransferBatch",
    "TransferSingle",
  ]);
  for (const sub of subscriptions) {
    assert.deepEqual([...sub.address].sort(), [ctf, positionManager].sort());
    assert.equal(sub.args.to, OWNER);
  }
});

test("receipt subscriptions can be removed and report socket errors to the caller", (t) => {
  const { subscriptions, unwatch, onError, start } = startWatching(t);
  const unwatchers = start();

  subscriptions[0]!.onError(new Error("socket closed"));
  assert.equal(onError.mock.callCount(), 1);

  unwatchers.forEach((stop) => stop());
  assert.equal(unwatch.mock.callCount(), 2);
});

test("receiving shares sells at once, then once more after 30 seconds", (t) => {
  const { sell, subscriptions, start } = startWatching(t);
  start();

  subscriptions[0]!.onLogs([{}]);
  assert.equal(sell.mock.callCount(), 1, "the first pass must not wait for a timer");

  t.mock.timers.tick(29_999);
  assert.equal(sell.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(sell.mock.callCount(), 2);
  t.mock.timers.tick(600_000);
  assert.equal(sell.mock.callCount(), 2, "there is only one follow-up");
});

test("a burst of receipts keeps one follow-up, timed from the last receipt", (t) => {
  const { sell, subscriptions, start } = startWatching(t);
  start();

  subscriptions[0]!.onLogs([{}]);
  t.mock.timers.tick(5_000);
  subscriptions[1]!.onLogs([{}]);
  assert.equal(sell.mock.callCount(), 2);

  t.mock.timers.tick(29_999);
  assert.equal(sell.mock.callCount(), 2);
  t.mock.timers.tick(1);
  assert.equal(sell.mock.callCount(), 3);
  t.mock.timers.tick(600_000);
  assert.equal(sell.mock.callCount(), 3);
});

test("stopping cancels a pending follow-up", (t) => {
  const { sell, subscriptions, start } = startWatching(t);
  start();
  subscriptions[0]!.onLogs([{}]);

  stopPositionSeller();
  t.mock.timers.tick(600_000);

  assert.equal(sell.mock.callCount(), 1);
});

/** Holds a pass open so triggers can arrive while it runs. */
function mockPass(t: TestContext) {
  const releases: Array<() => void> = [];
  const pass = t.mock.method(
    Seller as unknown as { runSellPass: () => Promise<void> },
    "runSellPass",
    () => new Promise<void>((resolve) => releases.push(resolve))
  );
  const release = async () => {
    releases.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { pass, release };
}

test("a trigger during a running pass gets its own pass instead of being dropped", async (t) => {
  const { pass, release } = mockPass(t);

  const running = Seller.triggerSell();
  void Seller.triggerSell();
  assert.equal(pass.mock.callCount(), 1, "passes never overlap");

  await release();
  assert.equal(pass.mock.callCount(), 2);
  await release();
  await running;
  assert.equal(pass.mock.callCount(), 2);
});

test("many triggers during a pass collapse into one more pass", async (t) => {
  const { pass, release } = mockPass(t);

  const running = Seller.triggerSell();
  void Seller.triggerSell();
  void Seller.triggerSell();
  void Seller.triggerSell();

  await release();
  await release();
  await running;
  assert.equal(pass.mock.callCount(), 2);
});

test("a real pass neither reads nor sells a redeemable position", async (t) => {
  const { client, reads } = fakeChain();
  const order = PolymarketOrderService.getInstance();
  t.mock.method(order, "initialize", (async () => {}) as never);
  t.mock.method(order, "getClient", (() => ({})) as never);
  t.mock.method(order, "getOpenOrders", (async () => []) as never);
  const post = t.mock.method(order, "postGTCOrder", (async () => {
    throw new Error("must not sell");
  }) as never);
  const seller = Seller as unknown as { inventory: unknown };
  const previous = seller.inventory;
  seller.inventory = new PolymarketInventory(client, OWNER, apiWith(apiPosition("11", true)));
  t.after(() => {
    seller.inventory = previous;
  });

  await Seller.triggerSell();

  assert.deepEqual(reads, []);
  assert.equal(post.mock.callCount(), 0);
});
