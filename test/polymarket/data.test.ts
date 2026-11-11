import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PolymarketDataClient,
  PositionsRateLimitError,
  parsePosition,
} from "../../src/backend/polymarket/data";

const row = {
  token_id: "123",
  condition_id: "0xcondition",
  current_size: 5,
  total_size: 500,
  current_price: 0.4,
  title: "Test",
  outcome: "Yes",
  negative_risk: true,
  redeemable: false,
};

test("Data API unwraps all cursor pages and maps current holdings rather than lifetime purchases", async () => {
  const calls: URL[] = [];
  const client = new PolymarketDataClient({
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      assert.equal(url.pathname, "/v2/positions");
      assert.equal(url.searchParams.get("status"), "OPEN");
      assert.equal(url.searchParams.get("filter_amount"), "0");
      assert.equal(url.searchParams.has("offset"), false);
      assert.equal(url.searchParams.has("market"), false);
      return calls.length === 1
        ? Response.json({ data: [row], pagination: { next_cursor: "opaque+/=" } })
        : Response.json({
            data: [{ ...row, token_id: "456", current_size: "2.5", current_price: "0.75" }],
            pagination: { next_cursor: null },
          });
    },
  });
  const positions = await client.fetchPositions("0xwallet");
  assert.equal(positions.length, 2);
  assert.equal(positions[0]?.size, 5);
  assert.equal(positions[0]?.negRisk, true);
  assert.equal(positions[1]?.size, 2.5);
  assert.equal(positions[1]?.currentPrice, 0.75);
  assert.equal(calls[1]?.searchParams.get("cursor"), "opaque+/=");
});

test("position decimals accept numbers, strings and mixed representations", () => {
  for (const current_size of [5.25, "5.25", "5.25e0"]) {
    for (const current_price of [0.4, "0.40", "4e-1"]) {
      const position = parsePosition({ ...row, current_size, current_price });
      assert.equal(position.size, 5.25);
      assert.equal(position.currentPrice, 0.4);
    }
  }
  assert.equal(parsePosition({ ...row, current_size: "0", current_price: "0" }).size, 0);
});

test("position decimals reject malformed, negative and non-finite values", () => {
  for (const field of ["current_size", "current_price"]) {
    for (const value of [
      "",
      " ",
      "garbage",
      "0x10",
      "NaN",
      "Infinity",
      "1e999",
      "-1",
      -1,
      NaN,
      Infinity,
      null,
      undefined,
      true,
      [],
      {},
    ]) {
      assert.throws(
        () => parsePosition({ ...row, [field]: value }),
        new RegExp(`Invalid position ${field}`)
      );
    }
  }
});

test("Data API rejects legacy envelopes, malformed rows and cursor loops", async () => {
  assert.throws(() => parsePosition({ ...row, token_id: 123 }));
  for (const body of [[row], { data: [row] }]) {
    await assert.rejects(
      new PolymarketDataClient({ fetch: async () => Response.json(body) }).fetchPositions("wallet")
    );
  }
  await assert.rejects(
    new PolymarketDataClient({
      fetch: async () => Response.json({ data: [row], pagination: { next_cursor: "loop" } }),
    }).fetchPositions("wallet"),
    /repeated cursor/
  );
});

test("Data API honors Retry-After and shares cooldown across subsequent scans", async () => {
  let now = 100000;
  let calls = 0;
  const client = new PolymarketDataClient({
    now: () => now,
    fetch: async () => {
      calls++;
      return new Response("rate limited", { status: 429, headers: { "retry-after": "120" } });
    },
  });
  await assert.rejects(client.fetchPositions("wallet"), PositionsRateLimitError);
  await assert.rejects(client.fetchPositions("wallet"), PositionsRateLimitError);
  assert.equal(calls, 1);
  now += 121000;
  await assert.rejects(client.fetchPositions("wallet"), PositionsRateLimitError);
  assert.equal(calls, 2);
});
