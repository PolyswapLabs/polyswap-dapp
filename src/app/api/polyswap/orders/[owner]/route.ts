import { type NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/backend/services/databaseService";
import { toPublicPolyswapOrder } from "@/backend/utils/publicPolyswapOrder";
import { createApiErrorResponder } from "@/lib/apiError";

const apiError = createApiErrorResponder("api-orders-owner");

/**
 * @swagger
 * /api/polyswap/orders/{owner}:
 *   get:
 *     tags:
 *       - Orders
 *     summary: Get orders by owner
 *     description: Returns all orders for a specific wallet address
 *     parameters:
 *       - name: owner
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address of the order owner
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Number of orders to return
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Offset for pagination
 *     responses:
 *       200:
 *         description: Orders for the specified owner
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Order'
 *                 count:
 *                   type: integer
 *       400:
 *         description: Invalid owner address
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string }> }
) {
  try {
    const { owner } = await params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "100";
    const offset = searchParams.get("offset") || "0";

    // Validate Ethereum address format
    if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
      return apiError({
        status: 400,
        error: "Invalid owner address",
        message: "Please provide a valid Ethereum address (0x followed by 40 hex characters)",
      });
    }

    const limitNum = Math.min(parseInt(limit) || 100, 500);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    const orders = await DatabaseService.getPolyswapOrdersByOwner(owner, limitNum, offsetNum);

    return NextResponse.json({
      success: true,
      data: orders.map(toPublicPolyswapOrder),
      count: orders.length,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        hasMore: orders.length === limitNum,
      },
      message: "Orders retrieved successfully",
    });
  } catch (error) {
    return apiError({ status: 500, error: "Failed to fetch orders", cause: error });
  }
}
