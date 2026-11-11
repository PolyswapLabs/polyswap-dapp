import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketRow } from "../../src/backend/interfaces/Market";
import {
  createMarketRecommendationService,
  RecommendationUnavailableError,
} from "../../src/backend/services/marketRecommendationService";
import { RECOMMENDATION_POLICY } from "../../src/shared/markets/recommendationPolicy";

const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const END_DATE = new Date(NOW + 30 * 86_400_000);
const OPTIONS = { oddsMin: 10, oddsMax: 90, limit: 20, offset: 0, category: null };

const candidate = (id: string): MarketRow => ({
  id,
  slug: `market-${id}`,
  event_slug: `event-${id}`,
  question: "Test?",
  description: null,
  category: "Crypto",
  tags: [],
  outcomes: ["Yes", "No"],
  volume: 100_000,
  liquidity: 20_000,
  end_date: END_DATE,
  clob_token_ids: [`${id}1`, `${id}2`],
  protocol_version: "v1",
  position_ids: [],
  condition_id: "condition",
  active: true,
  neg_risk: false,
  updated_at: new Date(NOW),
});

const gammaMarket = (id: string) => ({
  id,
  version: "v1",
  active: true,
  closed: false,
  acceptingOrders: true,
  outcomes: '["Yes","No"]',
  outcomePrices: '["0.4","0.6"]',
  clobTokenIds: JSON.stringify([`${id}1`, `${id}2`]),
  volume24hrClob: 5_000,
  liquidityClob: 20_000,
  spread: 0.01,
});

function service(fetchGamma: (url: URL) => Promise<Response>, markets = [candidate("1")]) {
  let time = NOW;
  const calls: URL[] = [];
  const recommendations = createMarketRecommendationService({
    loadCandidates: async () => ({ markets, truncated: false }),
    fetch: ((url: URL) => {
      calls.push(url);
      return fetchGamma(url);
    }) as typeof fetch,
    now: () => time,
    baseUrl: "https://gamma.test",
  });
  return { recommendations, calls, advance: (ms: number) => (time += ms) };
}

test("eligible markets are enriched from Gamma with one request per batch", async () => {
  const markets = Array.from({ length: 101 }, (_, index) => candidate(String(index + 1)));
  const { recommendations, calls } = service(
    async (url) => Response.json(url.searchParams.getAll("id").map(gammaMarket)),
    markets
  );

  const page = await recommendations.getPage({ ...OPTIONS, limit: 100 });

  assert.equal(page.source, "gamma");
  assert.equal(page.total, 101);
  assert.equal(page.candidateCount, 101);
  assert.equal(page.truncated, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.searchParams.getAll("version"), ["v1", "v2"]);
  assert.equal(calls[0]?.searchParams.get("limit"), String(RECOMMENDATION_POLICY.gammaBatchSize));
});

test("a market Gamma no longer returns is dropped from the snapshot", async () => {
  const { recommendations } = service(
    async () => Response.json([gammaMarket("1")]),
    [candidate("1"), candidate("2")]
  );

  const page = await recommendations.getPage(OPTIONS);

  assert.deepEqual(
    page.markets.map((market) => market.id),
    ["1"]
  );
  assert.equal(page.candidateCount, 2);
});

test("a rate limit serves database markets without internal columns, then pauses Gamma", async () => {
  const { recommendations, calls, advance } = service(
    async () => new Response("slow down", { status: 429, headers: { "retry-after": "600" } })
  );

  const page = await recommendations.getPage(OPTIONS);

  assert.equal(page.source, "database");
  const { updated_at: _omitted, ...stored } = candidate("1");
  assert.deepEqual(page.markets, [{ ...stored, end_date: END_DATE.toISOString() }]);

  advance(RECOMMENDATION_POLICY.cacheMs + 1);
  await recommendations.getPage(OPTIONS);
  assert.equal(calls.length, 1, "Gamma stays paused until Retry-After");
});

test("any other Gamma failure makes recommendations unavailable", async () => {
  const { recommendations } = service(async () => new Response("boom", { status: 500 }));
  await assert.rejects(recommendations.getPage(OPTIONS), RecommendationUnavailableError);
});
