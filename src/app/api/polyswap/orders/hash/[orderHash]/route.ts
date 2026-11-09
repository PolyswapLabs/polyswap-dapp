import { type NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/backend/services/databaseService";
import { toPublicPolyswapOrder } from "@/backend/utils/publicPolyswapOrder";
import { createApiErrorResponder } from "@/lib/apiError";

const apiError = createApiErrorResponder("api-order-hash");

/**
 * @swagger
 * /api/polyswap/orders/hash/{orderHash}:
 *   get:
 *     tags:
 *       - Orders
 *     summary: Get order by hash
 *     description: Returns a specific order by its order hash
 *     parameters:
 *       - name: orderHash
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Order hash (0x + 64 hex chars)
 *     responses:
 *       200:
 *         description: Order details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Order'
 *       400:
 *         description: Invalid order hash format
 *       404:
 *         description: Order not found
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderHash: string }> }
) {
  try {
    const { orderHash } = await params;

    // Validate order hash format (should be 66 characters: 0x + 64 hex chars)
    if (!orderHash || !/^0x[a-fA-F0-9]{64}$/.test(orderHash)) {
      return apiError({
        status: 400,
        error: "Invalid order hash",
        message: "Please provide a valid order hash (0x followed by 64 hex characters)",
      });
    }

    const order = await DatabaseService.getPolyswapOrderByHash(orderHash);

    if (!order) {
      return apiError({
        status: 404,
        error: "Order not found",
        message: `No order found with hash: ${orderHash}`,
      });
    }

    return NextResponse.json({
      success: true,
      data: toPublicPolyswapOrder(order),
      message: "Order retrieved successfully",
    });
  } catch (error) {
    return apiError({ status: 500, error: "Failed to fetch order", cause: error });
  }
}
