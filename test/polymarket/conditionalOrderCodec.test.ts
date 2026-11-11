import assert from "node:assert/strict";
import { test } from "node:test";
import { size, type Address, type Hex } from "viem";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { calculateOrderHash, decodeStaticInput, encodeStaticInput } =
  await import("../../src/backend/utils/conditionalOrderCodec");
const { encodePolyswapOrderData } =
  await import("../../src/backend/services/transactionEncodingService");
const { reconstructStaticInput } = await import("../../src/backend/listener/cron/orderHealthCheck");

const fields = {
  sellToken: "0x1111111111111111111111111111111111111111" as Address,
  buyToken: "0x2222222222222222222222222222222222222222" as Address,
  receiver: "0x3333333333333333333333333333333333333333" as Address,
  sellAmount: 1_000_000n,
  minBuyAmount: 5n,
  t0: 1_700_000_000n,
  t: 1_800_000_000n,
  polymarketOrderHash: `0x${"ab".repeat(32)}` as Hex,
  appData: `0x${"cd".repeat(32)}` as Hex,
};

const asStrings = {
  ...fields,
  sellAmount: "1000000",
  minBuyAmount: "5",
  t0: "1700000000",
  t: "1800000000",
};

const dbRow = (polymarketMakerAmount: string | null) =>
  ({
    sell_token: fields.sellToken,
    buy_token: fields.buyToken,
    owner: fields.receiver,
    sell_amount: "1000000",
    min_buy_amount: "5",
    start_time: new Date(1_700_000_000_000),
    end_time: new Date(1_800_000_000_000),
    polymarket_order_hash: fields.polymarketOrderHash,
    app_data: fields.appData,
    polymarket_maker_amount: polymarketMakerAmount,
  }) as unknown as Parameters<typeof reconstructStaticInput>[0];

test("a current order survives an encode and decode round trip", () => {
  const encoded = encodeStaticInput({ ...fields, polymarketMakerAmount: 42n });
  assert.equal(size(encoded), 320);
  assert.deepEqual(decodeStaticInput(encoded), { ...asStrings, polymarketMakerAmount: "42" });
});

test("a legacy order without a maker amount keeps the 9-field layout", () => {
  const encoded = encodeStaticInput({ ...fields, polymarketMakerAmount: null });
  assert.equal(size(encoded), 288);
  assert.deepEqual(decodeStaticInput(encoded), { ...asStrings, polymarketMakerAmount: "" });
});

test("the order hash matches the value computed before the codec was unified", () => {
  const hash = calculateOrderHash({
    handler: "0x4444444444444444444444444444444444444444",
    salt: `0x${"ee".repeat(32)}`,
    staticInput: "0x1234",
  });
  assert.equal(hash, "0x050df7788ac3714db3af532d4d87f481756a830341f2f7000f1f1d4691983904");
});

test("a stored order rebuilds the exact bytes the API committed on-chain", () => {
  const committed = encodePolyswapOrderData({
    ...asStrings,
    polymarketMakerAmount: "42",
  });
  assert.equal(reconstructStaticInput(dbRow("42")), committed);
});

test("a stored legacy order rebuilds the 9-field layout", () => {
  assert.equal(size(reconstructStaticInput(dbRow(null))), 288);
});
