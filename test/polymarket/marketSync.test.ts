import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { Prisma } from "@prisma/client";
import type { prisma as PrismaClient } from "../../src/backend/db/prisma";
import type { marketRepository as marketRepositoryType } from "../../src/backend/db/marketRepository";
import type { orderRepository as orderRepositoryType } from "../../src/backend/db/orderRepository";
import type { Market } from "../../src/backend/interfaces/Market";
import type { MarketSyncService as MarketSyncServiceType } from "../../src/backend/services/marketSyncService";
import type { gammaApi as GammaApiType } from "../../src/backend/polymarket/gamma";
import { diffMarkets, type StoredMarket } from "../../src/backend/services/marketSyncDiff";

const market = (overrides: Partial<Market> = {}): Market => ({
  id: "1",
  slug: "test-market",
  eventSlug: "event",
  question: "Will it happen?",
  description: "Résolution détaillée 🎯",
  category: "Crypto",
  tags: ["Crypto", "Bitcoin"],
  outcomes: ["Yes", "No"],
  volume: 1234.5678915,
  liquidity: 0.1 + 0.2,
  endDate: new Date("2030-01-02T03:04:05.678Z"),
  clobTokenIds: ["11", "12"],
  protocolVersion: "v1",
  positionIds: [],
  conditionId: "0xabc",
  active: true,
  negRisk: false,
  ...overrides,
});

/** What the database returns for `market()`: decimals rounded to scale 6, a new Date instance. */
const stored = (overrides: Partial<StoredMarket> = {}): StoredMarket => ({
  ...market(),
  volume: new Prisma.Decimal("1234.567892"),
  liquidity: new Prisma.Decimal("0.3"),
  endDate: new Date("2030-01-02T03:04:05.678Z"),
  ...overrides,
});

const diff = (incoming: Market, existing: StoredMarket | undefined) =>
  diffMarkets([incoming], existing ? [existing] : []);

test("a market matching its stored row is not rewritten", () => {
  assert.deepEqual(diff(market(), stored()), { changed: [], searchStale: [] });
});

test("each stored field is compared so a real change is never skipped", () => {
  const cases: Partial<Market>[] = [
    { eventSlug: "other" },
    { eventSlug: null },
    { category: null },
    { outcomes: ["No", "Yes"] },
    { volume: 1234.567893 },
    { liquidity: 0.31 },
    { endDate: new Date("2030-01-02T03:04:05.679Z") },
    { endDate: null },
    { clobTokenIds: ["11", "13"] },
    { protocolVersion: "v2" },
    { positionIds: ["21", "22"] },
    { conditionId: null },
    { active: false },
    { negRisk: true },
  ];
  for (const overrides of cases) {
    const incoming = market(overrides);
    const result = diff(incoming, stored());
    assert.deepEqual(result.changed, [incoming], JSON.stringify(overrides));
    assert.deepEqual(result.searchStale, [], `no reindex for ${JSON.stringify(overrides)}`);
  }
});

test("only the fields search indexes mark the search vector stale", () => {
  const cases: Partial<Market>[] = [
    { question: "Will it not happen?" },
    { description: "Changed" },
    { description: null },
    { slug: "renamed" },
    { tags: ["Crypto"] },
    { tags: ["Bitcoin", "Crypto"] },
  ];
  for (const overrides of cases) {
    const incoming = market(overrides);
    assert.deepEqual(
      diff(incoming, stored()),
      { changed: [incoming], searchStale: ["1"] },
      JSON.stringify(overrides)
    );
  }
});

test("a new market is written and needs no invalidation because its vector starts null", () => {
  const incoming = market();
  assert.deepEqual(diff(incoming, undefined), { changed: [incoming], searchStale: [] });
});

test("rows the migration left unclassified are rewritten", () => {
  const incoming = market();
  const result = diff(incoming, stored({ protocolVersion: null }));
  assert.deepEqual(result, { changed: [incoming], searchStale: [] });
});

test("database nulls in nullable numeric and boolean columns count as changes", () => {
  for (const overrides of [{ volume: null }, { liquidity: null }, { active: null }]) {
    assert.equal(diff(market(), stored(overrides)).changed.length, 1, JSON.stringify(overrides));
  }
});

// The rest runs a real sync through Prisma against embedded PostgreSQL with every migration
// applied. It replaces DATABASE_URL before importing the client, so no configured DB is reachable.
const PNPM = join(process.cwd(), "node_modules/.pnpm");
const socketRoot = join(
  PNPM,
  readdirSync(PNPM).find((dir) => dir.startsWith("@electric-sql+pglite-socket")) ?? "",
  "node_modules/@electric-sql"
);

let pg: { stop: () => Promise<void> };
let db: { close: () => Promise<void> };
let prisma: typeof PrismaClient;
let marketRepository: typeof marketRepositoryType;
let orderRepository: typeof orderRepositoryType;
let MarketSyncService: typeof MarketSyncServiceType;
let gammaApi: typeof GammaApiType;

before(async () => {
  const { PGlite } = await import(pathToFileURL(join(socketRoot, "pglite/dist/index.js")).href);
  const { PGLiteSocketServer } = await import(
    pathToFileURL(join(socketRoot, "pglite-socket/dist/index.js")).href
  );
  const database = new PGlite();
  for (const name of (await readdir("prisma/migrations")).filter((n) => /^\d/.test(n)).sort()) {
    await database.exec(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
  }
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve) => probe.close(resolve));
  const server = new PGLiteSocketServer({ db: database, port: address.port, host: "127.0.0.1" });
  await server.start();
  db = database;
  pg = server;

  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres?sslmode=disable`;
  process.env.DB_POOL_MAX = "1";
  ({ prisma } = await import("../../src/backend/db/prisma"));
  ({ marketRepository } = await import("../../src/backend/db/marketRepository"));
  ({ orderRepository } = await import("../../src/backend/db/orderRepository"));
  ({ MarketSyncService } = await import("../../src/backend/services/marketSyncService"));
  ({ gammaApi } = await import("../../src/backend/polymarket/gamma"));
});

after(async () => {
  await prisma.$disconnect();
  await pg.stop();
  await db.close();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM markets`;
  await prisma.$executeRaw`DELETE FROM tag_index`;
});

async function runSync(t: TestContext, markets: Market[]) {
  const mocked = t.mock.method(gammaApi, "getOpenMarkets", async () => markets);
  const result = await MarketSyncService.updateMarkets();
  mocked.mock.restore();
  return result;
}

async function sync(t: TestContext, markets: Market[]) {
  const result = await runSync(t, markets);
  assert.equal(result.status, "completed");
  return result.status === "completed" ? result.stats : undefined;
}

const row = async (id = "1") =>
  (
    await prisma.$queryRaw<{ updated_at: Date; vec: string | null; version: string | null }[]>`
      SELECT updated_at, search_vec::text AS vec, protocol_version AS version
      FROM markets WHERE id = ${id}`
  )[0];

const setVector = (id: string, word: string) =>
  prisma.$executeRaw`UPDATE markets SET search_vec = to_tsvector('simple', ${word}) WHERE id = ${id}`;

test("a repeat sync writes nothing, proving values survive the database round trip", async (t) => {
  const markets = [
    market(),
    market({
      id: "2",
      slug: "nulls",
      eventSlug: null,
      description: null,
      category: null,
      endDate: null,
      conditionId: null,
    }),
    market({
      id: "3",
      slug: "v2",
      protocolVersion: "v2",
      clobTokenIds: [],
      positionIds: ["21", "22"],
      tags: [],
      negRisk: true,
      volume: 0,
      liquidity: 1e-7,
    }),
  ];
  const first = await sync(t, markets);
  assert.equal(first?.upserted, 3);
  assert.equal(first?.unchanged, 0);
  const before = await row();

  const second = await sync(t, markets);
  assert.equal(second?.upserted, 0);
  assert.equal(second?.unchanged, 3);
  assert.deepEqual((await row())?.updated_at, before?.updated_at);
});

test("the first sync makes new markets searchable", async (t) => {
  await sync(t, [market()]);
  assert.match(String((await row())?.vec), /happen/);
});

test("a volume change is saved without rebuilding the search vector", async (t) => {
  await sync(t, [market()]);
  await setVector("1", "untouched");

  const stats = await sync(t, [market({ volume: 9000 })]);

  assert.equal(stats?.upserted, 1);
  const saved = await prisma.market.findUniqueOrThrow({ where: { id: "1" } });
  assert.equal(Number(saved.volume), 9000);
  assert.match(String((await row())?.vec), /untouched/);
});

test("a question change rebuilds that market's search vector and no other", async (t) => {
  await sync(t, [market(), market({ id: "2", slug: "other" })]);
  await setVector("1", "stale");
  await setVector("2", "untouched");

  await sync(t, [market({ question: "Completely renamed?" }), market({ id: "2", slug: "other" })]);

  const vec = String((await row("1"))?.vec);
  assert.match(vec, /renam/);
  assert.doesNotMatch(vec, /stale/);
  assert.match(String((await row("2"))?.vec), /untouched/);
});

test("a row the migration left unclassified gets its version", async (t) => {
  await sync(t, [market()]);
  await prisma.$executeRaw`UPDATE markets SET protocol_version = NULL WHERE id = '1'`;

  const stats = await sync(t, [market()]);

  assert.equal(stats?.upserted, 1);
  assert.equal((await row())?.version, "v1");
});

test("a failed search refresh is repaired by the next sync", async (t) => {
  await sync(t, [market()]);
  const renamed = market({ question: "Completely renamed?" });

  const failing = t.mock.method(marketRepository, "refreshMissingSearchVectors", async () => {
    throw new Error("statement timeout");
  });
  assert.deepEqual(await runSync(t, [renamed]), { status: "failed" });
  failing.mock.restore();

  const stats = await sync(t, [renamed]);

  assert.equal(stats?.upserted, 0, "the text was already saved");
  assert.match(String((await row())?.vec), /renam/);
});

test("a sync requested during another reports it is already running and fetches nothing", async (t) => {
  let release = (_markets: Market[]) => {};
  const fetched = t.mock.method(
    gammaApi,
    "getOpenMarkets",
    () => new Promise<Market[]>((resolve) => (release = resolve))
  );

  const running = MarketSyncService.updateMarkets();
  assert.deepEqual(await MarketSyncService.updateMarkets(), { status: "already_running" });
  assert.equal(fetched.mock.callCount(), 1);

  release([]);
  assert.equal((await running).status, "completed");
  fetched.mock.restore();
  assert.equal((await runSync(t, [])).status, "completed", "the guard is released afterwards");
});

test("the market-sync cron runs at once, then on every interval until stopped", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const update = t.mock.method(
    MarketSyncService,
    "updateMarkets",
    async () => ({ status: "already_running" }) as const
  );
  const { startMarketSync, stopMarketSync } =
    await import("../../src/backend/listener/cron/marketSync");
  t.after(stopMarketSync);

  startMarketSync(2);
  assert.equal(update.mock.callCount(), 1, "the first sync must not wait for the interval");
  startMarketSync(2);
  assert.equal(update.mock.callCount(), 1, "a second start is ignored");

  t.mock.timers.tick(119_999);
  assert.equal(update.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(update.mock.callCount(), 2);

  stopMarketSync();
  t.mock.timers.tick(600_000);
  assert.equal(update.mock.callCount(), 2);
});

// Nile delivers a bound empty string as NULL, so `id > ''` as a parameter matches nothing there.
// Embedded PostgreSQL does not do this, so assert on what is bound rather than on the result.
test("the search sweep binds no cursor on its first batch", async () => {
  const { missingSearchVectorIdsQuery } = await import("../../src/backend/db/marketRepository");
  assert.deepEqual(missingSearchVectorIdsQuery(null, 1000).values, [1000]);
  assert.deepEqual(missingSearchVectorIdsQuery("1059730", 1000).values, ["1059730", 1000]);
});

test("the search sweep covers every null row across batches and stops on rows it cannot fix", async () => {
  for (const id of ["a", "b", "c", "d", "e"]) {
    await marketRepository.upsertMarket(
      market({ id, slug: `market-${id}`, question: `Question ${id}?` })
    );
  }
  await prisma.$executeRaw`UPDATE markets SET tags = NULL WHERE id = 'c'`;

  assert.equal(await marketRepository.refreshMissingSearchVectors(2), 5);

  const missing = await prisma.$queryRaw<
    { id: string }[]
  >`SELECT id FROM markets WHERE search_vec IS NULL`;
  assert.deepEqual(missing, [{ id: "c" }]);
  await prisma.$executeRaw`UPDATE markets SET tags = '{}' WHERE id = 'c'`;
  assert.equal(await marketRepository.refreshMissingSearchVectors(2), 1);
});

test("orders can only be listed for a given owner", async () => {
  const owner = "0x1111111111111111111111111111111111111111";
  await prisma.polyswapOrder.create({
    data: {
      owner,
      sellToken: owner,
      buyToken: owner,
      sellAmount: "1",
      minBuyAmount: "1",
      startTime: new Date(1_000),
      endTime: new Date(2_000),
    },
  });

  assert.equal((await orderRepository.getPolyswapOrdersByOwner(owner)).length, 1);
  assert.deepEqual(await orderRepository.getPolyswapOrdersByOwner(""), []);
});

test("updating the status of a deleted order reports false instead of failing", async () => {
  assert.equal(await orderRepository.updateOrderStatusById(987_654, "filled"), false);
});
