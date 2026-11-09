import assert from "node:assert/strict";
import { type ApiKeyCreds, createSecureClient, type SignedOrder } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { privateKeyToAccount } from "viem/accounts";
import { maxUint256, type PublicClient, type WalletClient } from "viem";
import { getTradingConfig, type TradingContext } from "../../src/backend/polymarket/config";
import { computePolymarketOrderHash } from "../../src/backend/polymarket/orders";
import { PolymarketOrderService } from "../../src/backend/polymarket/clob";

// Public deterministic test key. Never loads .env or uses an operator wallet.
export const TEST_KEY = `0x${"11".repeat(32)}` as const;
export const account = privateKeyToAccount(TEST_KEY);
export const legacyId =
  "32338220190071351435772801779725302244575775216413325951443816017994629993401";
export const v2Id = "859200000273234893217704100561460298679196827126852708541873133663178194944";
export const condition = `0x${"ab".repeat(32)}`;
const key = "00000000-0000-4000-8000-000000000001";

export async function sdkHarness(context: TradingContext) {
  const assetId = context.protocolVersion === "v2" ? v2Id : legacyId;
  const calls: Array<{ url: URL; body?: Record<string, unknown> }> = [];
  let status = { filled: false, remaining: 0n };
  let allowance = maxUint256;
  let rejectOrder = false;
  let openOrdersUnavailable = false;
  const openOrderIds = new Set<string>();
  const chainCalls: Array<{ address: string; functionName: string }> = [];
  const client = await createSecureClient({
    wallet: account.address,
    signer: privateKey(TEST_KEY),
    credentials: { key, secret: "c2VjcmV0", passphrase: "test" } as ApiKeyCreds,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const rawBody = request.method === "POST" ? await request.clone().text() : "";
      const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined;
      calls.push({ url, body });
      if (url.pathname === "/auth/api-keys") return Response.json({ apiKeys: [key] });
      if (url.pathname.startsWith("/markets-by-token/")) {
        return Response.json({ condition_id: condition });
      }
      if (url.pathname.startsWith("/clob-markets/")) {
        return Response.json({
          mts: 0.01,
          nr: context.negRisk,
          t: [{ t: assetId, o: "Yes" }],
          fd: { r: 0, e: 1 },
        });
      }
      if (url.pathname === "/neg-risk") return Response.json({ neg_risk: context.negRisk });
      if (url.pathname === "/balance-allowance/update") return new Response(null, { status: 200 });
      if (url.pathname === "/balance-allowance") {
        return Response.json({
          balance: "100000000",
          allowances: { [getTradingConfig(context).exchange]: allowance.toString() },
        });
      }
      // Production answers 200 with a null body for orders it can't find, not the documented 404.
      if (url.pathname.startsWith("/data/order/")) return Response.json(null);
      if (url.pathname === "/data/orders") {
        if (openOrdersUnavailable) return new Response("unavailable", { status: 400 });
        const openOrder = (id: string) => ({
          asset_id: assetId,
          associate_trades: [],
          created_at: 1800000000,
          expiration: "0",
          id,
          maker_address: account.address,
          market: condition,
          order_type: "GTC",
          original_size: "10",
          outcome: "Yes",
          owner: key,
          price: "0.5",
          side: "SELL",
          size_matched: "5",
          status: "LIVE",
        });
        const id = url.searchParams.get("id");
        if (id !== null) {
          const data = openOrderIds.has(id) ? [openOrder(id)] : [];
          return Response.json({ data, next_cursor: "LTE=", limit: 1, count: data.length });
        }
        const page = calls.filter((call) => call.url.pathname === "/data/orders").length;
        return Response.json({
          data: [openOrder(`order-${page}`)],
          next_cursor: page === 1 ? "next-page" : "LTE=",
          limit: 1,
          count: 1,
        });
      }
      if (url.pathname === "/order") {
        assert.ok(body);
        const raw = body.order as SignedOrder;
        if (rejectOrder) {
          return Response.json({
            success: false,
            errorMsg: "test rejection",
            orderID: "",
            status: "",
            makingAmount: "",
            takingAmount: "",
          });
        }
        return Response.json({
          success: true,
          errorMsg: "",
          orderID: computePolymarketOrderHash(raw, context),
          status: "live",
          makingAmount: "0",
          takingAmount: "0",
          transactionsHashes: [],
          tradeIDs: [],
        });
      }
      throw new Error(`Unexpected SDK HTTP request: ${url}`);
    },
  });
  const publicClient = {
    readContract: async (args: { address: string; functionName: string }) => {
      chainCalls.push(args);
      if (args.functionName === "getOrderStatus") return status;
      if (args.functionName === "MAX_FEE_RATE") return 1000n;
      if (args.functionName === "allowance") return allowance;
      throw new Error(`Unexpected chain read: ${args.functionName}`);
    },
  } as unknown as PublicClient;
  const service = new PolymarketOrderService({
    clobClient: client,
    publicClient,
    walletClient: {} as WalletClient,
    ownerAddress: account.address,
  });
  return {
    service,
    client,
    calls,
    chainCalls,
    assetId,
    setStatus: (value: typeof status) => {
      status = value;
    },
    setAllowance: (value: bigint) => {
      allowance = value;
    },
    rejectOrders: () => {
      rejectOrder = true;
    },
    addOpenOrder: (id: string) => {
      openOrderIds.add(id);
    },
    failOpenOrders: () => {
      openOrdersUnavailable = true;
    },
  };
}

export function commitments(
  prepared: Awaited<ReturnType<PolymarketOrderService["prepareGTDOrder"]>>,
  context: TradingContext
) {
  return {
    ...context,
    exchangeAddress: prepared.exchangeAddress,
    signedOrder: prepared.signedOrder,
    signedOrderFormat: prepared.signedOrderFormat,
    expectedHash: prepared.polymarketOrderHash,
    expectedMakerAmount: prepared.makerAmount,
    expectedTokenId: prepared.signedOrder.tokenId,
    expectedExpiration: prepared.expiration,
    postOnly: true,
  };
}
