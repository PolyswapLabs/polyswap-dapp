import assert from "node:assert/strict";
import { test } from "node:test";
import { maxUint256, type PublicClient, type WalletClient } from "viem";
import { getPolymarketContracts, getTradingConfig } from "../../src/backend/polymarket/config";
import { PolymarketOrderService } from "../../src/backend/services/polymarketOrderService";
import { account, sdkHarness } from "./fixtures";

for (const context of [
  { protocolVersion: "v1", negRisk: false },
  { protocolVersion: "v1", negRisk: true },
  { protocolVersion: "v2", negRisk: false },
] as const) {
  test(`${context.protocolVersion}/${context.negRisk}: approvals use the correct ledger and spender, then refresh CLOB`, async () => {
    const h = await sdkHarness(context);
    const writes: Array<{ address: string; functionName: string; args: unknown[] }> = [];
    const publicClient = {
      readContract: async (args: { functionName: string }) =>
        args.functionName === "allowance" ? 0n : false,
      waitForTransactionReceipt: async () => ({ status: "success" }),
    } as unknown as PublicClient;
    const walletClient = {
      account,
      writeContract: async (args: (typeof writes)[number]) => {
        writes.push(args);
        return `0x${"00".repeat(32)}`;
      },
    } as unknown as WalletClient;
    const service = new PolymarketOrderService({
      clobClient: h.client,
      publicClient,
      walletClient,
      ownerAddress: account.address,
    });
    await service.ensureTradingApprovals(context);
    const config = getTradingConfig(context);
    assert.deepEqual(
      writes.map(({ address, functionName, args }) => ({ address, functionName, args })),
      [
        {
          address: config.ledger,
          functionName: "setApprovalForAll",
          args: [config.exchange, true],
        },
        {
          address: getPolymarketContracts().collateral,
          functionName: "approve",
          args: [config.exchange, maxUint256],
        },
      ]
    );
    assert.ok(
      h.calls.some(
        (call) =>
          call.url.pathname === "/balance-allowance/update" &&
          call.url.searchParams.get("asset_type") === "COLLATERAL"
      )
    );
  });
}

test("a reverted position approval never advances to collateral approval or cache refresh", async () => {
  const context = { protocolVersion: "v2" as const, negRisk: false };
  const h = await sdkHarness(context);
  let writes = 0;
  const service = new PolymarketOrderService({
    clobClient: h.client,
    ownerAddress: account.address,
    publicClient: {
      readContract: async () => false,
      waitForTransactionReceipt: async () => ({ status: "reverted" }),
    } as unknown as PublicClient,
    walletClient: {
      account,
      writeContract: async () => {
        writes++;
        return `0x${"00".repeat(32)}`;
      },
    } as unknown as WalletClient,
  });
  await assert.rejects(service.ensureTradingApprovals(context), /reverted/);
  assert.equal(writes, 1);
  assert.equal(
    h.calls.some((call) => call.url.pathname === "/balance-allowance/update"),
    false
  );
});
