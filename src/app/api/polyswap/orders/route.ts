import { type NextRequest, NextResponse } from "next/server";
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  maxUint256,
  type Address,
} from "viem";
import { DatabaseService } from "../../../../backend/services/databaseService";
import { TransactionEncodingService } from "../../../../backend/services/transactionEncodingService";
import { buildFallbackHandlerSetupTx } from "../../../../backend/services/safeFallbackHandlerService";
import { getClobAvailability } from "../../../../backend/services/polymarketStatusService";
import { getOrCreateSentinel } from "../../../../backend/services/polymarketSentinelService";
import { type PolyswapOrderData } from "../../../../backend/interfaces/PolyswapOrder";
import { createLogger } from "../../../../backend/logger";
import { isOrderCreationDisabled, isPolymarketSentinelPostOnly } from "@/lib/runtimeFlags";
import type { DatabasePolymarketSentinel } from "@/backend/interfaces/PolyswapOrder";
import { toPublicPolyswapOrder } from "@/backend/utils/publicPolyswapOrder";
import { createApiErrorResponder } from "@/lib/apiError";
import { fetchClobBestAsk } from "@/services/polymarket";
import { checkPostOnlyBuy, postOnlyCrossingMessage } from "@/lib/postOnlyOrder";
import { CowAppDataService } from "@/backend/services/cowAppDataService";

const log = createLogger("api-orders");
const apiError = createApiErrorResponder("api-orders");

const VAULT_RELAYER: Address = getAddress(
  process.env.VAULT_RELAYER ?? "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"
);
const COMPOSABLE_COW: Address = getAddress(
  process.env.COMPOSABLE_COW ?? "0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74"
);

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEADLINE_DAYS = 30;
const MAX_DEADLINE_DAYS = 365;

interface CreateOrderRequestBody {
  sellToken: unknown;
  buyToken: unknown;
  sellAmount: unknown;
  minBuyAmount?: unknown;
  selectedOutcome: unknown;
  betPercentage: unknown;
  startDate?: unknown;
  deadline?: unknown;
  marketId: unknown;
  owner: unknown;
}

function parseBoundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number | null {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/**
 * @swagger
 * /api/polyswap/orders:
 *   get:
 *     tags:
 *       - Orders
 *     summary: Get all orders
 *     description: Returns all Polyswap orders with optional filters
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Number of orders to return (max 500)
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *       - name: fromBlock
 *         in: query
 *         schema:
 *           type: integer
 *         description: Filter orders from this block number
 *       - name: toBlock
 *         in: query
 *         schema:
 *           type: integer
 *         description: Filter orders up to this block number
 *       - name: sellToken
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by sell token address
 *       - name: buyToken
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by buy token address
 *     responses:
 *       200:
 *         description: List of orders
 *       400:
 *         description: Invalid block range
 *       500:
 *         description: Server error
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const limitNum = parseBoundedInt(searchParams.get("limit"), 100, 1, 500);
    if (limitNum === null) {
      return apiError({
        status: 400,
        error: "Invalid limit",
        message: "limit must be an integer from 1 to 500",
      });
    }
    const offsetNum = parseBoundedInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    if (offsetNum === null) {
      return apiError({
        status: 400,
        error: "Invalid offset",
        message: "offset must be a non-negative integer",
      });
    }

    const fromBlock = searchParams.get("fromBlock");
    const toBlock = searchParams.get("toBlock");
    const ownerRaw = searchParams.get("owner");

    if (ownerRaw !== null && !isAddress(ownerRaw)) {
      return apiError({ status: 400, error: "Invalid owner address" });
    }

    let orders;

    if (fromBlock !== null || toBlock !== null) {
      if (fromBlock === null || toBlock === null) {
        return apiError({
          status: 400,
          error: "Invalid block range",
          message: "fromBlock and toBlock must be provided together",
        });
      }
      const fromBlockNum = Number(fromBlock);
      const toBlockNum = Number(toBlock);

      if (
        !Number.isInteger(fromBlockNum) ||
        !Number.isInteger(toBlockNum) ||
        fromBlockNum < 0 ||
        toBlockNum < 0 ||
        fromBlockNum > toBlockNum
      ) {
        return apiError({ status: 400, error: "Invalid block range" });
      }

      orders = await DatabaseService.getPolyswapOrdersByBlockRange(
        fromBlockNum,
        toBlockNum,
        limitNum,
        offsetNum
      );
    } else {
      orders = await DatabaseService.getPolyswapOrdersByOwner(ownerRaw ?? "", limitNum, offsetNum);
    }

    return NextResponse.json({
      success: true,
      data: orders.map(toPublicPolyswapOrder),
      count: orders.length,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        hasMore: orders.length === limitNum,
      },
      filters: {
        owner: ownerRaw,
        fromBlock: fromBlock !== null ? Number(fromBlock) : undefined,
        toBlock: toBlock !== null ? Number(toBlock) : undefined,
      },
      message: "Orders retrieved successfully",
    });
  } catch (error) {
    return apiError({ status: 500, error: "Failed to fetch orders", cause: error });
  }
}

/**
 * @swagger
 * /api/polyswap/orders:
 *   post:
 *     tags:
 *       - Orders
 *     summary: Create a new order (consolidated)
 *     description: >
 *       Creates a draft DB row, prepares a shared Polymarket sentinel, builds
 *       ComposableCoW calldata, and returns both a single-tx and an
 *       approve+create batch. The sentinel is posted only after confirmed
 *       Safe authorization.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sellToken
 *               - buyToken
 *               - sellAmount
 *               - selectedOutcome
 *               - betPercentage
 *               - marketId
 *               - owner
 *     responses:
 *       200:
 *         description: Order bundle created
 *       400:
 *         description: Validation error
 *       404:
 *         description: Market not found
 *       502:
 *         description: Polymarket placement failed
 *       503:
 *         description: Polymarket CLOB API is down or in maintenance
 *       500:
 *         description: Server error
 */
export async function POST(request: NextRequest) {
  if (isOrderCreationDisabled()) {
    return apiError({
      status: 503,
      error: "Order creation paused",
      message: "Order creation is temporarily blocked by the administrator.",
      code: "ORDER_CREATION_DISABLED",
    });
  }

  try {
    let body: CreateOrderRequestBody;
    try {
      body = (await request.json()) as CreateOrderRequestBody;
    } catch (error) {
      return apiError({ status: 400, error: "Invalid JSON body", cause: error });
    }

    const requiredFields = [
      "sellToken",
      "buyToken",
      "sellAmount",
      "selectedOutcome",
      "betPercentage",
      "marketId",
      "owner",
    ] as const;

    const missing = requiredFields.filter(
      (f) => body[f] === undefined || body[f] === null || body[f] === ""
    );
    if (missing.length > 0) {
      return apiError({
        status: 400,
        error: "Missing required fields",
        message: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      });
    }

    // Narrow typed fields
    const sellTokenRaw = body.sellToken;
    const buyTokenRaw = body.buyToken;
    const ownerRaw = body.owner;

    if (typeof sellTokenRaw !== "string" || !isAddress(sellTokenRaw)) {
      return apiError({ status: 400, error: "Invalid sellToken address" });
    }
    if (typeof buyTokenRaw !== "string" || !isAddress(buyTokenRaw)) {
      return apiError({ status: 400, error: "Invalid buyToken address" });
    }
    if (typeof ownerRaw !== "string" || !isAddress(ownerRaw)) {
      return apiError({ status: 400, error: "Invalid owner address" });
    }

    // isAddress is a type guard — these are now Address
    const sellToken: Address = sellTokenRaw;
    const buyToken: Address = buyTokenRaw;
    const owner: Address = ownerRaw;

    if (
      typeof body.sellAmount !== "string" ||
      !/^\d+$/.test(body.sellAmount) ||
      BigInt(body.sellAmount) <= 0n
    ) {
      return apiError({ status: 400, error: "sellAmount must be a positive number string" });
    }
    const sellAmount: string = body.sellAmount;

    const minBuyAmount: string =
      typeof body.minBuyAmount === "string" && body.minBuyAmount !== "" ? body.minBuyAmount : "1";
    if (!/^\d+$/.test(minBuyAmount) || BigInt(minBuyAmount) <= 0n) {
      return apiError({ status: 400, error: "minBuyAmount must be positive" });
    }

    if (typeof body.selectedOutcome !== "string" || body.selectedOutcome === "") {
      return apiError({ status: 400, error: "selectedOutcome must be a non-empty string" });
    }
    const selectedOutcome: string = body.selectedOutcome;

    const betPercentage = Number(body.betPercentage);
    if (
      !Number.isFinite(betPercentage) ||
      !Number.isInteger(betPercentage) ||
      betPercentage <= 0 ||
      betPercentage > 100
    ) {
      return apiError({
        status: 400,
        error: "betPercentage must be an integer from 1 to 100",
      });
    }

    if (typeof body.marketId !== "string" || body.marketId === "") {
      return apiError({ status: 400, error: "marketId must be a non-empty string" });
    }
    const marketId: string = body.marketId;

    if (body.startDate !== undefined && typeof body.startDate !== "string") {
      return apiError({
        status: 400,
        error: "Invalid startDate",
        message: "startDate must be a string",
      });
    }
    if (body.deadline !== undefined && typeof body.deadline !== "string") {
      return apiError({
        status: 400,
        error: "Invalid deadline",
        message: "deadline must be a string",
      });
    }

    const now = new Date();
    let startDate: Date;
    if (!body.startDate || body.startDate === "now") {
      startDate = new Date();
    } else {
      startDate = new Date(body.startDate);
      // Reject start dates more than 60s in the past
      if (startDate < new Date(now.getTime() - 60_000)) {
        return apiError({ status: 400, error: "startDate must not be in the past" });
      }
    }

    const market = await DatabaseService.getMarketById(marketId);
    if (!market) {
      return apiError({
        status: 404,
        error: "Market not found",
        message: `No market with id: ${marketId}`,
      });
    }

    const explicitDeadline = typeof body.deadline === "string" && body.deadline !== "";
    let deadline: Date;
    if (explicitDeadline) {
      deadline = new Date(body.deadline as string);
    } else {
      const marketEnd = market.end_date ? new Date(market.end_date) : null;
      deadline =
        marketEnd && marketEnd.getTime() > startDate.getTime()
          ? marketEnd
          : new Date(startDate.getTime() + DEFAULT_DEADLINE_DAYS * DAY_MS);
      const maxDeadline = new Date(startDate.getTime() + MAX_DEADLINE_DAYS * DAY_MS);
      if (deadline.getTime() > maxDeadline.getTime()) deadline = maxDeadline;
    }

    if (deadline <= startDate) {
      return apiError({ status: 400, error: "deadline must be after startDate" });
    }

    const clobTokenIds: string[] = market.clob_token_ids ?? [];
    if (clobTokenIds.length === 0) {
      return apiError({ status: 400, error: "Market has no CLOB token IDs" });
    }

    const outcomes: string[] = Array.isArray(market.outcomes) ? market.outcomes : [];
    if (outcomes.length === 0) {
      return apiError({ status: 500, error: "Market data is incomplete" });
    }

    const outcomeIndex = outcomes.indexOf(selectedOutcome);
    if (outcomeIndex === -1) {
      return apiError({
        status: 400,
        error: "Invalid outcome",
        message: `'${selectedOutcome}' is not valid. Valid outcomes: ${outcomes.join(", ")}`,
      });
    }
    if (outcomeIndex >= clobTokenIds.length) {
      return apiError({ status: 500, error: "Market data is incomplete" });
    }

    const tokenID = clobTokenIds[outcomeIndex];
    if (tokenID === undefined) {
      return apiError({ status: 500, error: "Selected outcome has no Polymarket token ID" });
    }

    const postOnly = isPolymarketSentinelPostOnly();
    if (postOnly) {
      let bestAsk: number | null;
      try {
        bestAsk = await fetchClobBestAsk(tokenID);
      } catch (error) {
        return apiError({
          status: 503,
          error: "Polymarket order book unavailable",
          message: "The live Polymarket order book could not be checked. Please try again.",
          code: "ORDER_BOOK_UNAVAILABLE",
          cause: error,
        });
      }

      const postOnlyCheck = checkPostOnlyBuy(betPercentage, bestAsk);
      if (postOnlyCheck.status === "unavailable") {
        return apiError({
          status: 503,
          error: "Polymarket order book unavailable",
          message: "The live Polymarket order book returned an invalid price. Please try again.",
          code: "ORDER_BOOK_UNAVAILABLE",
        });
      }
      if (postOnlyCheck.status === "crosses") {
        return apiError({
          status: 409,
          error: "Order crosses the live book",
          message: postOnlyCrossingMessage(postOnlyCheck),
          code: "POST_ONLY_WOULD_CROSS",
        });
      }
    }

    let sentinel: DatabasePolymarketSentinel;
    try {
      log.info(
        `preparing sentinel: market=${marketId} outcome=${selectedOutcome} ` +
          `tokenID=${tokenID} price=${betPercentage / 100} negRisk=${market.neg_risk}`
      );
      sentinel = await getOrCreateSentinel({
        marketId,
        tokenId: tokenID,
        outcomeSelected: selectedOutcome,
        priceCents: betPercentage,
        negRisk: market.neg_risk,
        postOnly,
        expiration: deadline,
      });
      log.info(
        `using sentinel ${sentinel.polymarket_order_hash} epoch=${sentinel.epoch} status=${sentinel.status}`
      );
    } catch (polymarketError) {
      const clob = await getClobAvailability();
      if (!clob.available) {
        return apiError({
          status: 503,
          error: "Polymarket unavailable",
          message: "Polymarket is temporarily unavailable. Please try again later.",
          cause: polymarketError,
        });
      }
      return apiError({
        status: 502,
        error: "Polymarket sentinel preparation failed",
        cause: polymarketError,
      });
    }

    const appData = await CowAppDataService.createHashOrDefault();

    const orderData: PolyswapOrderData = {
      sellToken,
      buyToken,
      receiver: owner,
      sellAmount,
      minBuyAmount,
      t0: Math.floor(startDate.getTime() / 1000).toString(),
      t: Math.floor(deadline.getTime() / 1000).toString(),
      polymarketOrderHash: sentinel.polymarket_order_hash,
      appData,
      polymarketMakerAmount: sentinel.polymarket_maker_amount,
    };

    const params = TransactionEncodingService.createConditionalOrderParams(orderData, {
      negRisk: market.neg_risk,
    });
    const createCalldata = TransactionEncodingService.encodeCreateWithContextCallData(params);
    const orderHash = TransactionEncodingService.calculateOrderHash(params);
    const approveCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [VAULT_RELAYER, maxUint256],
    });

    let orderId: number;
    try {
      orderId = await DatabaseService.insertPolyswapOrderFromForm({
        orderHash,
        handler: params.handler,
        sellToken,
        buyToken,
        sellAmount,
        minBuyAmount,
        startDate: startDate.toISOString(),
        deadline: deadline.toISOString(),
        marketId,
        owner,
        outcomeSelected: selectedOutcome,
        betPercentageValue: betPercentage,
        polymarketOrderHash: sentinel.polymarket_order_hash,
        appData,
        salt: params.salt,
        explicitDeadline,
        polymarketMakerAmount: sentinel.polymarket_maker_amount,
        sentinelId: sentinel.id,
      });
    } catch (dbError) {
      return apiError({ status: 500, error: "Failed to save order", cause: dbError });
    }

    // --- Detect fresh Safes that haven't installed CoW's ExtensibleFallbackHandler
    // yet. The setup self-call is returned alongside the order bundle so the
    // frontend can prepend it to whichever path it submits (single create vs.
    // approve+create). Failures here are non-fatal — we just skip the prepend.
    const fallbackSetupTx = await buildFallbackHandlerSetupTx(owner as Address);

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        polymarketOrderHash: sentinel.polymarket_order_hash,
        orderHash,
        tx: { to: COMPOSABLE_COW, data: createCalldata, value: "0" },
        batchTx: [
          { to: sellToken, data: approveCalldata, value: "0" },
          { to: COMPOSABLE_COW, data: createCalldata, value: "0" },
        ],
        fallbackSetupTx,
        sellToken,
        sellAmount,
        vaultRelayer: VAULT_RELAYER,
      },
    });
  } catch (error) {
    return apiError({ status: 500, error: "Failed to create order", cause: error });
  }
}
