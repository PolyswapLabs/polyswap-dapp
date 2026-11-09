import assert from "node:assert/strict";
import { test } from "node:test";
import { getTradingAssetIds } from "../../src/lib/polymarket/protocol";
import { PolymarketAPIService } from "../../src/backend/services/polymarketAPIService";
import { enrichRecommendation } from "../../src/lib/marketRecommendations";
import type { DatabaseMarket } from "../../src/backend/interfaces/Database";
import { mergeMarket, toViewModel, tokenPriceRequests } from "../../src/hooks/useMarketsData";

const source = { outcomes: '["No","Yes"]', clobTokenIds: '["11","12"]', positionIds: ["21", "22"] };

const unclassifiedRow = {
  id: "1",
  slug: "test",
  event_slug: "event",
  question: "Test?",
  description: null,
  category: "Crypto",
  tags: [],
  outcomes: ["Yes", "No"],
  volume: 100,
  liquidity: 10,
  end_date: null,
  clob_token_ids: ["11", "12"],
  protocol_version: null,
  position_ids: [],
  condition_id: null,
  active: false,
};

test("unclassified cached markets still display using their cached CLOB IDs", () => {
  assert.deepEqual(tokenPriceRequests([unclassifiedRow]), [
    { token_id: "11", side: "BUY" },
    { token_id: "11", side: "SELL" },
    { token_id: "12", side: "BUY" },
    { token_id: "12", side: "SELL" },
  ]);
  const view = toViewModel(mergeMarket(unclassifiedRow, { "11": { BUY: "0.4", SELL: "0.6" } }));
  assert.equal(view?.question, "Test?");
  assert.equal(view?.yesTokenId, "11");
  assert.equal(view?.noTokenId, "12");
  assert.equal(view?.yesProbability, 0.5);
});

test("unclassified markets with unusable cached IDs display without prices", () => {
  const row = { ...unclassifiedRow, clob_token_ids: ["11"] };
  assert.deepEqual(tokenPriceRequests([row]), []);
  const view = toViewModel(mergeMarket(row, {}));
  assert.equal(view?.question, "Test?");
  assert.equal(view?.yesTokenId, null);
});

test("classified markets keep version-selected IDs and unknown versions still throw", () => {
  const v2 = {
    ...unclassifiedRow,
    protocol_version: "v2" as const,
    position_ids: ["21", "22"],
  };
  assert.equal(toViewModel(mergeMarket(v2, {}))?.yesTokenId, "21");
  assert.throws(() =>
    tokenPriceRequests([{ ...unclassifiedRow, protocol_version: "v3" as never }])
  );
});

test("version selects IDs even when both arrays exist; invalid identifiers fail closed", () => {
  assert.deepEqual(getTradingAssetIds({ ...source, protocolVersion: "v1" }), ["11", "12"]);
  assert.deepEqual(getTradingAssetIds({ ...source, protocolVersion: "v2" }), ["21", "22"]);
  for (const protocolVersion of [null, undefined, "v3"]) {
    assert.throws(() => getTradingAssetIds({ ...source, protocolVersion }));
  }
  for (const ids of [
    ["1", "1"],
    ["1"],
    ["1", "0xabc"],
    ["1", "0"],
    ["1", (1n << 256n).toString()],
  ]) {
    assert.throws(() => getTradingAssetIds({ ...source, protocolVersion: "v2", positionIds: ids }));
  }
});

test("Gamma independently walks both protocols and preserves their metadata", async (t) => {
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const version = url.searchParams.get("version");
    return Response.json({
      events: [
        {
          slug: `event-${version}`,
          tags: [{ label: "Crypto" }],
          markets: [
            {
              ...source,
              id: version,
              version,
              slug: `market-${version}`,
              question: "Test?",
              conditionId: "0xcondition",
            },
          ],
        },
      ],
      next_cursor: null,
    });
  });
  const markets = await PolymarketAPIService.getOpenMarkets({ limit: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(markets.map((market) => market.protocolVersion).sort(), ["v1", "v2"]);
  assert.equal(markets[1]?.conditionId, "0xcondition");
});

test("recommendations accept V2 position IDs, preserve outcome order and reject protocol changes", () => {
  const now = Date.now();
  const candidate: DatabaseMarket = {
    id: "1",
    slug: "test",
    event_slug: "event",
    question: "Test?",
    description: null,
    category: "Crypto",
    tags: [],
    outcomes: ["No", "Yes"],
    volume: 100000,
    liquidity: 20000,
    end_date: new Date(now + 30 * 86400000),
    clob_token_ids: ["11", "12"],
    protocol_version: "v2",
    position_ids: ["21", "22"],
    condition_id: "condition",
    active: true,
    neg_risk: false,
  };
  const gamma = {
    ...source,
    id: "1",
    version: "v2",
    active: true,
    closed: false,
    acceptingOrders: true,
    outcomePrices: '["0.4","0.6"]',
    volume24hrClob: 5000,
    liquidityClob: 20000,
    spread: 0.01,
  };
  const result = enrichRecommendation(candidate, gamma, now);
  assert.equal(result.market?.yesTokenId, "22");
  assert.equal(result.market?.noTokenId, "21");
  assert.equal(
    enrichRecommendation(candidate, { ...gamma, version: "v1" }, now).rejection,
    "protocol_mismatch"
  );
});

test("Gamma uses after_cursor and keeps cursor walks independent for each version", async (t) => {
  const calls = new Map<string, number>();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const version = url.searchParams.get("version");
    assert.ok(version);
    const count = (calls.get(version) ?? 0) + 1;
    calls.set(version, count);
    assert.equal(url.searchParams.has("cursor"), false);
    if (count === 2) assert.equal(url.searchParams.get("after_cursor"), `${version}-next`);
    return Response.json({
      events: [
        {
          markets: [
            {
              ...source,
              id: `${version}-${count}`,
              version,
              slug: `${version}-${count}`,
              question: "Test?",
            },
          ],
        },
      ],
      next_cursor: count === 1 ? `${version}-next` : null,
    });
  });
  const markets = await PolymarketAPIService.getOpenMarkets({ limit: 1 });
  assert.equal(markets.length, 4);
  assert.equal(calls.get("v1"), 2);
  assert.equal(calls.get("v2"), 2);
});
