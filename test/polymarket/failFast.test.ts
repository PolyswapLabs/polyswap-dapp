import assert from "node:assert/strict";
import { test } from "node:test";

// Port 1 refuses connections, so these exercise real driver failures.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { verifyDatabaseConnection } = await import("../../src/backend/db/prisma");
const { DatabaseService } = await import("../../src/backend/services/databaseService");

test("an unreachable database stops startup instead of being reported as connected", async () => {
  await assert.rejects(verifyDatabaseConnection());
});

test("a failed status write reaches the caller so catch-up cannot pass the event", async () => {
  await assert.rejects(DatabaseService.updateOrderStatusById(1, "filled"));
});
