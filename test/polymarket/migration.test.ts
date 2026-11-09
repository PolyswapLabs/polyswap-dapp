import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Embedded PostgreSQL. This test has no URL and cannot contact the configured DB.
test("SQL migration preserves legacy sentinels, isolates protocol buckets and supports both asset lists", async () => {
  const db = new PGlite();
  try {
    const migrations = (await readdir("prisma/migrations"))
      .filter((name) => /^\d/.test(name))
      .sort();
    for (const name of migrations.filter((name) => name < "20261023000000")) {
      await db.exec(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
    }
    const signed = { salt: "123", expiration: "2000000000", signature: "0x1234" };
    const hash = `0x${"12".repeat(32)}`;
    await db.query(
      "INSERT INTO markets (id, slug, question, outcomes, clob_token_ids) VALUES ('legacy', 'legacy', 'Test?', '[\"Yes\",\"No\"]', ARRAY['11','12'])"
    );
    await db.query(
      "INSERT INTO polymarket_sentinels (market_id, token_id, outcome_selected, price_cents, polymarket_order_hash, polymarket_maker_amount, signed_order, expiration) VALUES ('legacy', '11', 'Yes', 50, $1, 2500000, $2, '2030-01-01')",
      [hash, signed]
    );
    await db.exec(
      await readFile(
        "prisma/migrations/20261023000000_polymarket_protocol_v2/migration.sql",
        "utf8"
      )
    );
    const old = (
      await db.query<{
        protocol_version: string;
        exchange_address: null;
        signed_order_format: string;
        signed_order: unknown;
        polymarket_order_hash: string;
      }>("SELECT * FROM polymarket_sentinels")
    ).rows[0];
    assert.ok(old);
    assert.equal(old.protocol_version, "v1");
    assert.equal(old.exchange_address, null);
    assert.equal(old.signed_order_format, "clob-v2");
    assert.deepEqual(old.signed_order, signed);
    assert.equal(old.polymarket_order_hash, hash);
    assert.equal(
      (await db.query<{ protocol_version: null }>("SELECT protocol_version FROM markets")).rows[0]
        ?.protocol_version,
      null
    );
    await db.query("UPDATE markets SET protocol_version = 'v1' WHERE id = 'legacy'");
    await db.query(
      "INSERT INTO markets (id, slug, question, outcomes, protocol_version, position_ids) VALUES ('v2', 'v2', 'New?', '[\"Yes\",\"No\"]', 'v2', ARRAY['21','22'])"
    );
    const rows = await db.query<{ id: string; ids: string[] }>(
      "SELECT id, CASE protocol_version WHEN 'v1' THEN clob_token_ids WHEN 'v2' THEN position_ids END AS ids FROM markets ORDER BY id"
    );
    assert.deepEqual(rows.rows, [
      { id: "legacy", ids: ["11", "12"] },
      { id: "v2", ids: ["21", "22"] },
    ]);
    await db.query(
      "INSERT INTO polymarket_sentinels (market_id, protocol_version, token_id, outcome_selected, price_cents, epoch, polymarket_order_hash, polymarket_maker_amount, signed_order, expiration) VALUES ('legacy', 'v2', '11', 'Yes', 50, 1, $1, 2500000, $2, '2030-01-01')",
      [`0x${"34".repeat(32)}`, signed]
    );
    assert.equal((await db.query("SELECT * FROM polymarket_sentinels")).rows.length, 2);
    await assert.rejects(
      db.query("UPDATE markets SET protocol_version = 'v3' WHERE id = 'legacy'"),
      /protocol_version_check/
    );
    await assert.rejects(
      db.query("UPDATE polymarket_sentinels SET protocol_version = 'v3' WHERE id = 1"),
      /protocol_version_check/
    );
  } finally {
    await db.close();
  }
});
