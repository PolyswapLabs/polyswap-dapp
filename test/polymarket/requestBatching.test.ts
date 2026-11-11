import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { createRequestBatcher } from "../../src/shared/requestBatcher";
import type { MarketRow } from "../../src/backend/interfaces/Market";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { marketRepository, resolveMarketIdentifiers } =
  await import("../../src/backend/db/marketRepository");
const { GET } = await import("../../src/app/api/markets/route");

function recordingLoader() {
  const calls: string[][] = [];
  const loadMany = async (keys: string[]) => {
    calls.push(keys);
    return new Map(keys.filter((k) => k !== "missing").map((k) => [k, k.toUpperCase()]));
  };
  return { calls, loadMany };
}

test("sibling loads in the same tick share one bulk request", async () => {
  const { calls, loadMany } = recordingLoader();
  const load = createRequestBatcher({ loadMany, maxBatchSize: 20, windowMs: 0 });

  const values = await Promise.all(["a", "b", "a", "missing"].map(load));

  assert.deepEqual(values, ["A", "B", "A", undefined]);
  assert.deepEqual(calls, [["a", "b", "missing"]]);
});

test("a full queue flushes immediately and the rest goes in the next request", async () => {
  const { calls, loadMany } = recordingLoader();
  const load = createRequestBatcher({ loadMany, maxBatchSize: 2, windowMs: 0 });

  await Promise.all(["a", "b", "c"].map(load));

  assert.deepEqual(calls, [["a", "b"], ["c"]]);
});

test("a failed bulk request rejects every caller in that batch, and later loads still work", async () => {
  let fail = true;
  const load = createRequestBatcher<string>({
    loadMany: async (keys) => {
      if (fail) throw new Error("CLOB /batch-prices-history failed: 429");
      return new Map(keys.map((k) => [k, k]));
    },
    maxBatchSize: 20,
    windowMs: 0,
  });

  const results = await Promise.allSettled([load("a"), load("b")]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["rejected", "rejected"]
  );

  fail = false;
  assert.equal(await load("a"), "a");
});

const market = (id: string, slug: string) => ({ id, slug }) as MarketRow;

test("batch identifiers resolve like the single-market route: ids first for numbers, slugs first otherwise", () => {
  const numericSlug = market("1", "42");
  const byId42 = market("42", "answer");
  const bySlug = market("7", "will-it-rain");

  const resolved = resolveMarketIdentifiers(
    ["42", "will-it-rain", "7", "unknown"],
    [numericSlug, byId42, bySlug]
  );

  assert.equal(resolved.get("42"), byId42);
  assert.equal(resolved.get("will-it-rain"), bySlug);
  assert.equal(resolved.get("7"), bySlug);
  assert.equal(resolved.has("unknown"), false);
});

const get = (query: string) => GET(new NextRequest(`http://localhost/api/markets${query}`));

test("the batch markets route rejects missing or oversized id lists without reading the table", async (t) => {
  const read = t.mock.method(marketRepository, "getMarketsByIdentifiers", async () => new Map());
  const tooMany = Array.from({ length: 51 }, (_, i) => `ids=${i}`).join("&");

  assert.equal((await get("")).status, 400);
  assert.equal((await get(`?${tooMany}`)).status, 400);
  assert.equal(read.mock.callCount(), 0);
});

test("the batch markets route dedupes ids and returns markets keyed by identifier", async (t) => {
  const row = market("42", "answer");
  const read = t.mock.method(
    marketRepository,
    "getMarketsByIdentifiers",
    async (ids: string[]) => new Map(ids.filter((id) => id === "42").map((id) => [id, row]))
  );

  const response = await get("?ids=42&ids=42&ids=nope");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(read.mock.calls[0]?.arguments[0], ["42", "nope"]);
  assert.deepEqual(body, { success: true, data: { "42": { id: "42", slug: "answer" } } });
});
