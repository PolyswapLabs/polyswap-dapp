import { type NextRequest, NextResponse } from "next/server";
import { orderRepository } from "@/backend/db/orderRepository";
import { toPublicPolyswapOrder } from "@/backend/utils/publicPolyswapOrder";
import { createApiErrorResponder } from "@/server/apiError";

const apiError = createApiErrorResponder("api-order-id");

/**
 * @swagger
 * /api/polyswap/orders/id/{id}:
 *   get:
 *     tags:
 *       - Orders
 *     summary: Get order by ID
 *     description: Returns a specific order by its numerical ID
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order numerical ID
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
 *         description: Invalid order ID
 *       404:
 *         description: Order not found
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId) || orderId <= 0) {
      return apiError({
        status: 400,
        error: "Invalid order ID",
        message: "Order ID must be a positive integer",
      });
    }

    const order = await orderRepository.getPolyswapOrderById(orderId);
    if (!order) {
      return apiError({
        status: 404,
        error: "Order not found",
        message: `No order found with ID: ${orderId}`,
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
