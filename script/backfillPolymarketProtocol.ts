#!/usr/bin/env node --import tsx
// Intentionally does not load .env before selecting an explicit database target.
import {
  getTradingAssetIds,
  parseProtocolVersion,
  parseStringArray,
} from "../src/lib/polymarket/protocol";

const target = process.env.POLYMARKET_MIGRATION_DATABASE_URL;
if (!target) {
  throw new Error(
    "Set POLYMARKET_MIGRATION_DATABASE_URL explicitly. This script never falls back to the application's database."
  );
}
if (process.env.ENVIRONMENT !== "dev" && process.env.ENVIRONMENT !== "local") {
  throw new Error(
    "Run metadata backfill with ENVIRONMENT=dev or local and an explicitly selected development database"
  );
}
process.env.DATABASE_URL = target;
const { prisma } = await import("../src/backend/db/prisma");
const apply = process.argv.includes("--apply");
let checked = 0;
let failed = 0;
let cursor: string | undefined;
try {
  while (true) {
    const markets = await prisma.market.findMany({
      where: { protocolVersion: null },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (!markets.length) break;
    for (const market of markets) {
      try {
        const response = await fetch(
          `${process.env.POLYMARKET_API_URL ?? "https://gamma-api.polymarket.com"}/markets/${encodeURIComponent(market.id)}`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok) throw new Error(`Gamma HTTP ${response.status}`);
        const raw = await response.json();
        if (String(raw.id) !== market.id) throw new Error("Gamma returned a different market");
        const data = {
          protocolVersion: parseProtocolVersion(raw.version),
          outcomes: parseStringArray(raw.outcomes),
          clobTokenIds: parseStringArray(raw.clobTokenIds),
          positionIds: parseStringArray(raw.positionIds),
          conditionId: typeof raw.conditionId === "string" ? raw.conditionId : null,
        };
        getTradingAssetIds(data);
        if (apply) await prisma.market.update({ where: { id: market.id }, data });
        checked++;
      } catch (error) {
        failed++;
        console.error(`Market ${market.id} unchanged: ${String(error)}`);
      }
    }
    const last = markets.at(-1);
    if (!last) break;
    cursor = last.id;
  }
  console.log(
    `${apply ? "Updated" : "Dry run checked"} ${checked} market metadata records; ${failed} unresolved. Sentinel signatures and hashes were not modified.`
  );
  if (failed) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
