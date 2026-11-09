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
const { computeSellPrice, PolymarketPositionSellerService: Seller } =
  await import("../../src/backend/services/polymarketPositionSellerService");
const { PolymarketOrderService } =
  await import("../../src/backend/services/polymarketOrderService");
const { startPositionSeller, subscribePositionReceipts, stopPositionSeller } =
  await import("../../src/backend/listener/cron/positionSeller");
const { handleTrade, handleLiveTrade } = await import("../../src/backend/listener/handlers/trade");
const { account, sdkHarness, TEST_KEY, v2Id: ASSET } = await import("./fixtures");

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
  t.mock.method(Seller, "getOwnerAddress", (() => OWNER) as never);
  const sell = t.mock.method(Seller, "sellPositions", (async () => {}) as never);
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

  const running = Seller.sellPositions();
  void Seller.sellPositions();
  assert.equal(pass.mock.callCount(), 1, "passes never overlap");

  await release();
  assert.equal(pass.mock.callCount(), 2);
  await release();
  await running;
  assert.equal(pass.mock.callCount(), 2);
});

test("many triggers during a pass collapse into one more pass", async (t) => {
  const { pass, release } = mockPass(t);

  const running = Seller.sellPositions();
  void Seller.sellPositions();
  void Seller.sellPositions();
  void Seller.sellPositions();

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

  await Seller.sellPositions();

  assert.deepEqual(reads, []);
  assert.equal(post.mock.callCount(), 0);
});

type StubPosition = { protocolVersion: "v1" | "v2"; currentPrice?: number };

const BOOK = { bids: [{ price: "0.4" }], tickSize: 0.01, conditionId: "0xbook" };

/** Runs real passes over stubbed positions; only the SDK transport and the chain are faked. */
async function sellHarness(t: TestContext, stubs: StubPosition[]) {
  const h = await sdkHarness({ protocolVersion: "v2", negRisk: false });
  t.mock.method(PolymarketOrderService, "getInstance", () => h.service);
  t.mock.method(h.service, "initialize", (async () => {}) as never);
  t.mock.method(h.service, "ensureTradingApprovals", (async () => {}) as never);
  const openOrders = t.mock.method(h.service, "getOpenOrders", (async () => []) as never);
  const book = t.mock.method(h.client, "fetchOrderBook", (async () => BOOK) as never);
  const post = t.mock.method(h.service, "postGTCOrder", (async () => ({
    response: { orderId: "order-1" },
  })) as never);
  const record = t.mock.method(DatabaseService, "recordSoldPosition", (async () => 1) as never);
  const seller = Seller as unknown as { inventory: unknown };
  const previous = seller.inventory;
  seller.inventory = {
    read: async () =>
      stubs.map(({ protocolVersion, currentPrice }) => ({
        assetId: ASSET,
        protocolVersion,
        balance: 1_000_000n,
        metadata:
          currentPrice === undefined
            ? undefined
            : {
                assetId: ASSET,
                conditionId: "0xposition",
                size: 1,
                currentPrice,
                title: "A market",
                outcome: "Yes",
                negRisk: false,
                redeemable: false,
              },
      })),
    balance: async () => 3_000_000n,
  };
  t.after(() => {
    seller.inventory = previous;
  });
  const postedOrder = (index: number) =>
    post.mock.calls[index]?.arguments[0 as never] as unknown as Record<string, unknown>;
  const recorded = () => record.mock.calls[0]?.arguments[0 as never] as unknown;
  return { post, record, book, openOrders, postedOrder, recorded };
}

test("a sale uses the discounted price and the balance re-read before posting", async (t) => {
  const { post, postedOrder, recorded } = await sellHarness(t, [
    { protocolVersion: "v1", currentPrice: 0.5 },
  ]);

  await Seller.sellPositions();

  assert.equal(post.mock.callCount(), 1);
  const order = postedOrder(0);
  assert.equal(order.tokenID, ASSET);
  assert.equal(order.protocolVersion, "v1");
  assert.equal(order.side, "SELL");
  assert.equal(order.price, 0.47);
  assert.equal(order.size, "3");
  assert.deepEqual(recorded(), {
    assetId: ASSET,
    conditionId: "0xposition",
    protocolVersion: "v1",
    size: "3",
    sellPrice: 0.47,
    currentPrice: 0.5,
    orderId: "order-1",
    marketTitle: "A market",
    outcome: "Yes",
  });
});

test("a position the Data API does not know is priced from the book, recorded as unknown", async (t) => {
  const { postedOrder, recorded } = await sellHarness(t, [{ protocolVersion: "v1" }]);

  await Seller.sellPositions();

  assert.equal(postedOrder(0).price, 0.38);
  assert.equal(postedOrder(0).negRisk, false);
  assert.deepEqual(recorded(), {
    assetId: ASSET,
    conditionId: "0xbook",
    protocolVersion: "v1",
    size: "3",
    sellPrice: 0.38,
    currentPrice: 0.4,
    orderId: "order-1",
    marketTitle: ASSET,
    outcome: "Unknown",
  });
});

test("an asset already being sold is not sold again from the other ledger", async (t) => {
  const { post } = await sellHarness(t, [
    { protocolVersion: "v1", currentPrice: 0.5 },
    { protocolVersion: "v2", currentPrice: 0.5 },
  ]);

  await Seller.sellPositions();

  assert.equal(post.mock.callCount(), 1);
});

test("a failed sale does not stop the same asset being sold from the other ledger", async (t) => {
  const { post, postedOrder } = await sellHarness(t, [
    { protocolVersion: "v1", currentPrice: 0.5 },
    { protocolVersion: "v2", currentPrice: 0.5 },
  ]);
  post.mock.mockImplementationOnce((async () => {
    throw new Error("rejected");
  }) as never);

  await Seller.sellPositions();

  assert.equal(post.mock.callCount(), 2);
  assert.equal(postedOrder(1).protocolVersion, "v2");
});

test("a sale whose audit record fails still counts as placed", async (t) => {
  const { post, record } = await sellHarness(t, [
    { protocolVersion: "v1", currentPrice: 0.5 },
    { protocolVersion: "v2", currentPrice: 0.5 },
  ]);
  record.mock.mockImplementation((async () => {
    throw new Error("db down");
  }) as never);

  await assert.doesNotReject(Seller.sellPositions());

  assert.equal(post.mock.callCount(), 1, "the audit failure must not cause a second sale");
});

test("an asset with an open SELL order is left alone, but a BUY does not block it", async (t) => {
  const { post, openOrders } = await sellHarness(t, [{ protocolVersion: "v1", currentPrice: 0.5 }]);

  openOrders.mock.mockImplementationOnce((async () => [{ side: "SELL", assetId: ASSET }]) as never);
  await Seller.sellPositions();
  assert.equal(post.mock.callCount(), 0);

  openOrders.mock.mockImplementationOnce((async () => [{ side: "BUY", assetId: ASSET }]) as never);
  await Seller.sellPositions();
  assert.equal(post.mock.callCount(), 1);
});

test("a position with no price signal is not sold", async (t) => {
  const { post, book } = await sellHarness(t, [{ protocolVersion: "v1", currentPrice: 0 }]);
  book.mock.mockImplementation((async () => ({ ...BOOK, bids: [] })) as never);

  await Seller.sellPositions();

  assert.equal(post.mock.callCount(), 0);
});

type QuotedBook = Parameters<typeof computeSellPrice>[0];

const orderBook = (tickSize: number, ...bids: string[]) =>
  ({ tickSize, bids: bids.map((price) => ({ price })) }) as unknown as QuotedBook;

test("the sell price is 5% under the position's price, floored to the tick", () => {
  assert.deepEqual(computeSellPrice(orderBook(0.01, "0.2"), { currentPrice: 0.5 }), {
    price: 0.47,
    referencePrice: 0.5,
  });
});

test("without a position price the best bid is the reference", () => {
  const expected = { price: 0.39, referencePrice: 0.42 };
  assert.deepEqual(computeSellPrice(orderBook(0.01, "0.4", "0.42", "0.1")), expected);
  assert.deepEqual(computeSellPrice(orderBook(0.01, "0.42"), { currentPrice: 0 }), expected);
});

test("the sell price never drops below one tick", () => {
  assert.equal(computeSellPrice(orderBook(0.01), { currentPrice: 0.01 })?.price, 0.01);
});

test("finer ticks are honoured without floating-point noise", () => {
  assert.equal(computeSellPrice(orderBook(0.001), { currentPrice: 0.333 })?.price, 0.316);
});

test("no position price and an empty book yields no price", () => {
  assert.equal(computeSellPrice(orderBook(0.01)), null);
  assert.equal(computeSellPrice(orderBook(0.01), { currentPrice: 0 }), null);
});

function mockSellerCron(t: TestContext) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const initialize = t.mock.method(Seller, "initialize", (() => {}) as never);
  const sell = t.mock.method(Seller, "sellPositions", (async () => {}) as never);
  t.after(stopPositionSeller);
  return { initialize, sell };
}

test("the sell cron sells at once, then on every interval until stopped", async (t) => {
  const { sell } = mockSellerCron(t);

  await startPositionSeller(5);
  assert.equal(sell.mock.callCount(), 1, "the first pass must not wait for the interval");
  await startPositionSeller(5);
  assert.equal(sell.mock.callCount(), 1, "a second start is ignored");

  t.mock.timers.tick(299_999);
  assert.equal(sell.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(sell.mock.callCount(), 2);

  stopPositionSeller();
  t.mock.timers.tick(600_000);
  assert.equal(sell.mock.callCount(), 2);
});

test("a seller that cannot initialize fails the start and schedules nothing", async (t) => {
  const { initialize, sell } = mockSellerCron(t);
  initialize.mock.mockImplementation((() => {
    throw new Error("Private key (PK) is not configured");
  }) as never);

  await assert.rejects(startPositionSeller(5), /Private key/);

  t.mock.timers.tick(600_000);
  assert.equal(sell.mock.callCount(), 0);
});

/** Applies env overrides for one test; undefined removes the variable. */
function withEnv(t: TestContext, overrides: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(overrides)) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

test("the seller starts from PK and RPC alone, so a CLOB outage cannot stop the listener", (t) => {
  withEnv(t, { PK: TEST_KEY, CLOB_API_KEY: undefined, CLOB_SECRET: undefined });
  const order = new PolymarketOrderService();
  t.mock.method(PolymarketOrderService, "getInstance", () => order);
  const seller = Seller as unknown as { inventory: unknown; ownerAddress: unknown };
  const previous = { inventory: seller.inventory, ownerAddress: seller.ownerAddress };
  seller.inventory = null;
  t.after(() => Object.assign(seller, previous));

  Seller.initialize();

  assert.equal(Seller.getOwnerAddress(), account.address);
  assert.ok(seller.inventory instanceof PolymarketInventory);
  assert.equal(order.isReady(), false, "the CLOB client is not built just to read the chain");
});

test("a missing private key still fails the seller's start", (t) => {
  withEnv(t, { PK: undefined });
  assert.throws(() => new PolymarketOrderService().getChainReader(), /Private key/);
});
