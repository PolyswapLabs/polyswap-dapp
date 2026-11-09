import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

// Runs the real script and real Prisma SQL against embedded PostgreSQL and a local Gamma stub.
// The script gets a scratch cwd and a minimal env, so it cannot reach the configured database.
const REPO = process.cwd();
const PNPM = join(REPO, "node_modules/.pnpm");
// pglite-socket is only installed transitively; its sibling pglite is the matching version.
const socketRoot = join(
  PNPM,
  readdirSync(PNPM).find((dir) => dir.startsWith("@electric-sql+pglite-socket")) ?? "",
  "node_modules/@electric-sql"
);
const importFrom = (path: string) => import(pathToFileURL(path).href);

const marketId = (n: number) => `m${String(n).padStart(4, "0")}`;

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function backfill(rows: number, args: string[], failing: string[] = []) {
  const { PGlite } = await importFrom(join(socketRoot, "pglite/dist/index.js"));
  const { PGLiteSocketServer } = await importFrom(join(socketRoot, "pglite-socket/dist/index.js"));

  const db = new PGlite();
  for (const name of (await readdir("prisma/migrations")).filter((n) => /^\d/.test(n)).sort()) {
    await db.exec(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
  }
  for (let i = 1; i <= rows; i++) {
    await db.query("INSERT INTO markets (id, slug, question) VALUES ($1, $1, 'Test?')", [
      marketId(i),
    ]);
  }
  const pgPort = await freePort();
  const pg = new PGLiteSocketServer({ db, port: pgPort, host: "127.0.0.1" });
  await pg.start();

  const gamma: Server = createHttpServer((req, res) => {
    const id = decodeURIComponent(String(req.url).split("/").pop() ?? "");
    if (failing.includes(id)) {
      res.writeHead(500).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id,
        version: "v1",
        outcomes: '["Yes","No"]',
        clobTokenIds: '["11","12"]',
        positionIds: [],
        conditionId: null,
      })
    );
  });
  await new Promise<void>((resolve) => gamma.listen(0, "127.0.0.1", resolve));
  const gammaAddress = gamma.address();
  assert.ok(gammaAddress && typeof gammaAddress === "object");

  const cwd = await mkdtemp(join(tmpdir(), "polyswap-backfill-"));
  try {
    const { code, output } = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(join(REPO, "node_modules/tsx/dist/loader.mjs")).href,
            join(REPO, "script/backfillPolymarketProtocol.ts"),
            ...args,
          ],
          {
            cwd,
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              NODE_ENV: "test",
              ENVIRONMENT: "local",
              POLYMARKET_MIGRATION_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`,
              POLYMARKET_API_URL: `http://127.0.0.1:${gammaAddress.port}`,
              DB_POOL_MAX: "1",
            } as NodeJS.ProcessEnv,
          }
        );
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, output }));
      }
    );
    const remaining = await db.query(
      "SELECT id FROM markets WHERE protocol_version IS NULL ORDER BY id"
    );
    return {
      code,
      output,
      stillNull: (remaining.rows as { id: string }[]).map((row) => row.id),
    };
  } finally {
    await new Promise((resolve) => gamma.close(resolve));
    await pg.stop();
    await db.close();
    await rm(cwd, { recursive: true, force: true });
  }
}

test("one --apply run classifies every market across page boundaries", async () => {
  const result = await backfill(205, ["--apply"]);
  assert.deepEqual(result.stillNull, []);
  assert.equal(result.code, 0);
  assert.match(result.output, /Updated 205 market metadata records; 0 unresolved/);
});

test("a failed market stays unresolved without costing its neighbours or looping", async () => {
  const result = await backfill(250, ["--apply"], [marketId(100)]);
  assert.deepEqual(result.stillNull, [marketId(100)]);
  assert.equal(result.code, 1);
  assert.match(result.output, /Updated 249 market metadata records; 1 unresolved/);
});

test("a dry run checks every market and writes nothing", async () => {
  const result = await backfill(205, []);
  assert.equal(result.stillNull.length, 205);
  assert.equal(result.code, 0);
  assert.match(result.output, /Dry run checked 205 market metadata records; 0 unresolved/);
});
