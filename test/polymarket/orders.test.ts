import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, encodeAbiParameters, recoverAddress } from "viem";
import { getTradingConfig, getPolyswapHandlerAddress } from "../../src/backend/polymarket/config";
import {
  computePolymarketOrderHash,
  hasReachedFillGate,
  parseStoredSignedOrder,
  ORDER_STATUS_ABI,
} from "../../src/backend/polymarket/orders";
import { account, commitments, sdkHarness } from "./fixtures";

for (const protocolVersion of ["v1", "v2"] as const) {
  for (const negRisk of [false, true]) {
    test(`${protocolVersion} ${negRisk ? "NegRisk" : "binary"}: real SDK signs, persists and submits the committed hash`, async () => {
      const context = { protocolVersion, negRisk };
      const h = await sdkHarness(context);
      const expiration = Math.floor(Date.now() / 1000) + 3600;
      const prepared = await h.service.prepareGTDOrder({
        ...context,
        tokenID: h.assetId,
        price: 0.5,
        size: 5,
        side: "BUY",
        expiration,
        postOnly: true,
      });
      assert.equal(
        h.calls.filter((call) => call.url.pathname === "/order").length,
        0,
        "preparation must not post"
      );
      assert.equal(
        await recoverAddress({
          hash: prepared.polymarketOrderHash,
          signature: prepared.signedOrder.signature,
        }),
        account.address
      );
      assert.equal(prepared.expiration, expiration);
      const response = await h.service.postPreparedGTDOrder(commitments(prepared, context));
      assert.equal(response.orderId, prepared.polymarketOrderHash);
      const payload = h.calls.find((call) => call.url.pathname === "/order")?.body;
      assert.ok(payload);
      assert.equal(payload.postOnly, true);
      assert.ok(
        h.chainCalls
          .filter((call) => call.functionName === "getOrderStatus")
          .every((call) => call.address === getTradingConfig(context).exchange)
      );
      const wrongVersion = {
        ...context,
        protocolVersion: protocolVersion === "v1" ? ("v2" as const) : ("v1" as const),
      };
      assert.notEqual(
        computePolymarketOrderHash(prepared.signedOrder, wrongVersion),
        prepared.polymarketOrderHash
      );
    });
  }
}

test("old prepared CTF JSON survives SDK migration without re-signing", async () => {
  const context = { protocolVersion: "v1" as const, negRisk: true };
  const h = await sdkHarness(context);
  const prepared = await h.service.prepareGTDOrder({
    ...context,
    tokenID: h.assetId,
    price: 0.5,
    size: 5,
    side: "BUY",
    expiration: Math.floor(Date.now() / 1000) + 3600,
    postOnly: true,
  });
  const { orderType: _type, postOnly: _policy, ...fields } = prepared.signedOrder;
  const legacy = { ...fields, expiration: String(prepared.expiration) };
  const normalized = parseStoredSignedOrder(legacy, "clob-v2", true);
  assert.equal(normalized.signature, prepared.signedOrder.signature);
  assert.equal(computePolymarketOrderHash(normalized, context), prepared.polymarketOrderHash);
  await h.service.postPreparedGTDOrder({
    ...commitments(prepared, context),
    signedOrder: legacy,
    signedOrderFormat: "clob-v2",
  });
});

test("wrong protocol, altered maker amount, token, expiry and stale fill never post", async () => {
  const context = { protocolVersion: "v2" as const, negRisk: false };
  const h = await sdkHarness(context);
  const prepared = await h.service.prepareGTDOrder({
    ...context,
    tokenID: h.assetId,
    price: 0.5,
    size: 5,
    side: "BUY",
    expiration: Math.floor(Date.now() / 1000) + 3600,
    postOnly: true,
  });
  const input = commitments(prepared, context);
  for (const change of [
    { expectedMakerAmount: "1" },
    { expectedTokenId: "123" },
    { expectedExpiration: 1 },
    { expectedHash: `0x${"00".repeat(32)}` },
  ]) {
    await assert.rejects(h.service.postPreparedGTDOrder({ ...input, ...change }));
  }
  await assert.rejects(
    h.service.postPreparedGTDOrder({ ...input, protocolVersion: "v1", exchangeAddress: null })
  );
  h.setStatus({ filled: false, remaining: 1n });
  await assert.rejects(h.service.postPreparedGTDOrder(input));
  assert.equal(h.calls.filter((call) => call.url.pathname === "/order").length, 0);
});

test("GTD cannot extend a short deadline and V2 allowance includes fees", async () => {
  const context = { protocolVersion: "v2" as const, negRisk: false };
  const h = await sdkHarness(context);
  const config = {
    ...context,
    tokenID: h.assetId,
    price: 0.5,
    size: 5,
    side: "BUY" as const,
    postOnly: true,
  };
  await assert.rejects(
    h.service.prepareGTDOrder({ ...config, expiration: Math.floor(Date.now() / 1000) + 60 }),
    /three minutes/
  );
  const prepared = await h.service.prepareGTDOrder({
    ...config,
    expiration: Math.floor(Date.now() / 1000) + 3600,
  });
  h.setAllowance(BigInt(prepared.makerAmount));
  await assert.rejects(
    h.service.postPreparedGTDOrder(commitments(prepared, context)),
    /fee ceiling/
  );
  h.setAllowance(BigInt(prepared.makerAmount) * 2n);
  h.rejectOrders();
  await assert.rejects(h.service.postPreparedGTDOrder(commitments(prepared, context)), /rejected/);
});

test("V2 handler is required and never falls back to legacy", () => {
  const old = process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_V2;
  delete process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_V2;
  try {
    assert.throws(
      () => getPolyswapHandlerAddress({ protocolVersion: "v2", negRisk: true }),
      /HANDLER_V2/
    );
  } finally {
    if (old !== undefined) process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_V2 = old;
  }
});

test("V2 status ABI and collateral gate handle untouched, partial, full and price-improvement dust", () => {
  for (const [filled, remaining, expected] of [
    [false, 0n, false],
    [false, 900001n, false],
    [false, 900000n, true],
    [false, 12500n, true],
    [true, 0n, true],
  ] as const) {
    const encoded = encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "filled", type: "bool" },
            { name: "remaining", type: "uint248" },
          ],
        },
      ],
      [{ filled, remaining }]
    );
    const [status] = decodeAbiParameters(ORDER_STATUS_ABI[0].outputs, encoded);
    assert.equal(hasReachedFillGate(status, 1000000n), expected);
  }
});

for (const protocolVersion of ["v1", "v2"] as const) {
  for (const negRisk of [false, true]) {
    test(`${protocolVersion} ${negRisk ? "NegRisk" : "binary"}: SELL uses the selected exchange and exact decimal size`, async () => {
      const context = { protocolVersion, negRisk };
      const h = await sdkHarness(context);
      const { response } = await h.service.postGTCOrder({
        ...context,
        tokenID: h.assetId,
        price: 0.5,
        size: "5.12",
        side: "SELL",
      });
      assert.ok(response.orderId);
      const payload = h.calls.find((call) => call.url.pathname === "/order")?.body;
      assert.ok(payload);
      const raw = payload.order as { side: string; makerAmount: string };
      assert.equal(raw.side, "SELL");
      assert.equal(raw.makerAmount, "5120000");
    });
  }
}

test("open-order reads consume every SDK page and expose normalized fields", async () => {
  const h = await sdkHarness({ protocolVersion: "v2", negRisk: false });
  const orders = await h.service.getOpenOrders();
  assert.equal(orders.length, 2);
  assert.equal(orders[0]?.assetId, h.assetId);
  assert.equal(orders[0]?.originalSize, "10");
  assert.equal(orders[0]?.sizeMatched, "5");
  assert.equal(h.calls.filter((call) => call.url.pathname === "/data/orders").length, 2);
});
