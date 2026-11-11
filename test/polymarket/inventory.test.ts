import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicClient } from "viem";
import { PolymarketInventory } from "../../src/backend/polymarket/inventory";
import { PolymarketDataClient } from "../../src/backend/polymarket/data";
import { getPolymarketContracts } from "../../src/backend/polymarket/config";
import { account } from "./fixtures";

test("inventory reads the correct ledger and discovers batch transfers during API lag", async () => {
  const contracts = getPolymarketContracts();
  const reads: Array<{ address: string; args: [string, bigint] }> = [];
  const client = {
    getBlockNumber: async () => 3000n,
    getLogs: async (args: { address: string; event: { name: string } }) => {
      if (args.address === contracts.positionManager && args.event.name === "TransferBatch") {
        return [{ args: { ids: [21n, 22n] } }];
      }
      if (args.address === contracts.ctf && args.event.name === "TransferSingle") {
        return [{ args: { id: 11n } }];
      }
      return [];
    },
    readContract: async (args: { address: string; args: [string, bigint] }) => {
      reads.push(args);
      if (args.address === contracts.ctf && args.args[1] === 11n) return 2_000_000n;
      if (args.address === contracts.positionManager && args.args[1] === 21n) return 5_000_000n;
      return 0n;
    },
  } as unknown as PublicClient;
  const data = new PolymarketDataClient({
    fetch: async () => Response.json({ data: [], pagination: { next_cursor: null } }),
  });
  const inventory = await new PolymarketInventory(client, account.address, data).read();
  assert.deepEqual(
    inventory.map(({ protocolVersion, assetId, balance }) => ({
      protocolVersion,
      assetId,
      balance,
    })),
    [
      { protocolVersion: "v1", assetId: "11", balance: 2_000_000n },
      { protocolVersion: "v2", assetId: "21", balance: 5_000_000n },
    ]
  );
  assert.ok(
    reads.some((read) => read.address === contracts.positionManager && read.args[1] === 22n)
  );
});

test("API failure still permits authoritative on-chain discovery", async () => {
  const contracts = getPolymarketContracts();
  const client = {
    getBlockNumber: async () => 100n,
    getLogs: async (args: { address: string; event: { name: string }; fromBlock: bigint }) => {
      assert.equal(args.fromBlock, 0n);
      return args.address === contracts.positionManager && args.event.name === "TransferSingle"
        ? [{ args: { id: 42n } }]
        : [];
    },
    readContract: async () => 1000000n,
  } as unknown as PublicClient;
  let errors = 0;
  const data = new PolymarketDataClient({
    fetch: async () => new Response("limited", { status: 429, headers: { "retry-after": "120" } }),
  });
  const rows = await new PolymarketInventory(client, account.address, data).read({
    onApiError: () => {
      errors++;
    },
  });
  assert.equal(errors, 1);
  assert.equal(rows[0]?.protocolVersion, "v2");
});

for (const failedScan of [
  "v1:TransferSingle",
  "v1:TransferBatch",
  "v2:TransferSingle",
  "v2:TransferBatch",
  "all",
]) {
  test(`${failedScan} scan failure preserves API holdings and successful transfer scans`, async () => {
    const contracts = getPolymarketContracts();
    const discovered = new Map([
      ["v1:TransferSingle", "11"],
      ["v1:TransferBatch", "12"],
      ["v2:TransferSingle", "21"],
      ["v2:TransferBatch", "22"],
    ]);
    const scanError = new Error("RPC range rejected");
    const errors: Array<{ error: unknown; protocolVersion: string | undefined }> = [];
    const client = {
      getBlockNumber: async () => 3000n,
      getLogs: async (args: { address: string; event: { name: string } }) => {
        const protocol = args.address === contracts.ctf ? "v1" : "v2";
        const key = `${protocol}:${args.event.name}`;
        if (failedScan === "all" || key === failedScan) throw scanError;
        const id = BigInt(discovered.get(key)!);
        return args.event.name === "TransferSingle"
          ? [{ args: { id } }]
          : [{ args: { ids: [id] } }];
      },
      readContract: async () => 2_000_000n,
    } as unknown as PublicClient;
    const data = new PolymarketDataClient({
      fetch: async () =>
        Response.json({
          data: [
            {
              token_id: "99",
              condition_id: "0xcondition",
              current_size: "999",
              current_price: "0.4",
              negative_risk: false,
              redeemable: false,
            },
          ],
          pagination: { next_cursor: null },
        }),
    });
    const inventory = await new PolymarketInventory(client, account.address, data).read({
      onScanError: (error, protocolVersion) => errors.push({ error, protocolVersion }),
    });
    const expected = ["v1:99", "v2:99"];
    for (const [key, id] of discovered) {
      if (failedScan !== "all" && key !== failedScan) expected.push(`${key.split(":")[0]}:${id}`);
    }
    assert.deepEqual(
      inventory.map(({ protocolVersion, assetId }) => `${protocolVersion}:${assetId}`).sort(),
      expected.sort()
    );
    assert.ok(inventory.every(({ balance }) => balance === 2_000_000n));
    assert.equal(inventory.find(({ assetId }) => assetId === "99")?.metadata?.size, 999);
    assert.equal(errors.length, failedScan === "all" ? 4 : 1);
    assert.ok(
      errors.every(
        ({ error, protocolVersion }) =>
          error === scanError && (protocolVersion === "v1" || protocolVersion === "v2")
      )
    );
  });
}

test("block-number failure still checks API holdings in both ledgers", async () => {
  const contracts = getPolymarketContracts();
  const scanError = new Error("Block number unavailable");
  const errors: unknown[] = [];
  const client = {
    getBlockNumber: async () => {
      throw scanError;
    },
    getLogs: async () => assert.fail("Cannot scan without a block number"),
    readContract: async (args: { address: string }) =>
      args.address === contracts.positionManager ? 1_000_000n : 0n,
  } as unknown as PublicClient;
  const data = new PolymarketDataClient({
    fetch: async () =>
      Response.json({
        data: [
          {
            token_id: "99",
            condition_id: "0xcondition",
            current_size: 1,
            current_price: 0.4,
            negative_risk: false,
            redeemable: false,
          },
        ],
        pagination: { next_cursor: null },
      }),
  });
  const inventory = await new PolymarketInventory(client, account.address, data).read({
    onScanError: (error) => errors.push(error),
  });
  assert.deepEqual(errors, [scanError]);
  assert.deepEqual(
    inventory.map(({ assetId, protocolVersion, balance }) => ({
      assetId,
      protocolVersion,
      balance,
    })),
    [{ assetId: "99", protocolVersion: "v2", balance: 1_000_000n }]
  );
});
