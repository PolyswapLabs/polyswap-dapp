import { type NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { createOrder, OrderRejectedError } from "@/backend/orders/createOrder";
import { parseCreateOrderRequest } from "@/backend/orders/createOrderRequest";
import { orderRepository } from "@/backend/db/orderRepository";
import { toPublicPolyswapOrder } from "@/backend/utils/publicPolyswapOrder";
import { createApiErrorResponder } from "@/lib/apiError";
import { isOrderCreationDisabled } from "@/lib/runtimeFlags";

const apiError = createApiErrorResponder("api-orders");

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
 *     summary: List orders by owner or block range
 *     description: Returns Polyswap orders. Requires owner, or both fromBlock and toBlock.
 *     parameters:
 *       - name: owner
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter orders by owner address
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
 *     responses:
 *       200:
 *         description: List of orders
 *       400:
 *         description: Missing filter, invalid owner or invalid block range
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

      orders = await orderRepository.getPolyswapOrdersByBlockRange(
        fromBlockNum,
        toBlockNum,
        limitNum,
        offsetNum
      );
    } else if (ownerRaw !== null) {
      orders = await orderRepository.getPolyswapOrdersByOwner(ownerRaw, limitNum, offsetNum);
    } else {
      return apiError({
        status: 400,
        error: "Missing filter",
        message: "Provide owner, or fromBlock and toBlock",
      });
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
 *             properties:
 *               sellToken: { type: string, description: "ERC-20 address" }
 *               buyToken: { type: string, description: "ERC-20 address" }
 *               sellAmount: { type: string, description: "Integer amount in the token's smallest unit" }
 *               minBuyAmount: { type: string, description: "Integer amount in the token's smallest unit" }
 *               selectedOutcome: { type: string }
 *               betPercentage: { type: integer, description: "Trigger probability, 1 to 100" }
 *               startDate: { type: string, description: "ISO date, or now" }
 *               deadline: { type: string, format: date-time }
 *               marketId: { type: string }
 *               owner: { type: string, description: "Safe address" }
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
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return apiError({ status: 400, error: "Invalid JSON body", cause: error });
    }

    const parsed = parseCreateOrderRequest(body);
    if ("rejection" in parsed) return apiError(parsed.rejection);

    return NextResponse.json({ success: true, data: await createOrder(parsed.value) });
  } catch (error) {
    if (error instanceof OrderRejectedError) return apiError(error.rejection);
    return apiError({ status: 500, error: "Failed to create order", cause: error });
  }
}
