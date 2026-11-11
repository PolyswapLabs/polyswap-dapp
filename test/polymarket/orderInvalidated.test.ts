import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Log } from "viem";

// Override before importing the DB module, even when this test is run directly.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { orderRepository } = await import("../../src/backend/db/orderRepository");
const { handleOrderInvalidated, handleLiveOrderInvalidated } =
  await import("../../src/backend/listener/handlers/orderInvalidated");

const eventLog = {
  topics: encodeEventTopics({
    abi: [parseAbiItem("event OrderInvalidated(address indexed owner, bytes orderUid)")],
    eventName: "OrderInvalidated",
    args: { owner: "0x1111111111111111111111111111111111111111" },
  }),
  data: encodeAbiParameters([{ type: "bytes" }], ["0x1234"]),
  transactionHash: `0x${"ab".repeat(32)}`,
  blockNumber: 1n,
  logIndex: 0,
} as unknown as Log;

test("a DB failure on a live event is contained so it cannot become an unhandled rejection", async (t) => {
  const lookup = t.mock.method(orderRepository, "getPolyswapOrderByUid", async () => {
    throw new Error("connection terminated");
  });

  await assert.doesNotReject(handleLiveOrderInvalidated(eventLog));

  assert.equal(lookup.mock.callCount(), 1, "the event must reach the database step");
});

test("a malformed live event is contained too", async () => {
  await assert.doesNotReject(handleLiveOrderInvalidated({ ...eventLog, topics: [] } as Log));
});

test("catch-up still sees the failure, so it cannot save a block past a failed event", async (t) => {
  t.mock.method(orderRepository, "getPolyswapOrderByUid", async () => {
    throw new Error("connection terminated");
  });

  await assert.rejects(handleOrderInvalidated(eventLog), /connection terminated/);
});
