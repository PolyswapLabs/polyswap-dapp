import { type NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/backend/services/databaseService";
import { authenticateOrderAction } from "@/backend/orders/orderActionAuth";
import { toPublicPolyswapOrder } from "@/backend/utils/publicPolyswapOrder";
import { createApiErrorResponder } from "@/lib/apiError";
import { getPostHogClient } from "@/lib/posthog-server";

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
 *   delete:
 *     tags:
 *       - Orders
 *     summary: Cancel a draft order
 *     description: Deletes an off-chain draft. Requires a signed cancel_draft message from the owner.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signature, timestamp]
 *             properties:
 *               signature: { type: string }
 *               timestamp: { type: integer }
 *     responses:
 *       200:
 *         description: Draft deleted
 *       400:
 *         description: Invalid id, body, or order state
 *       401:
 *         description: Bad signature
 *       404:
 *         description: Order not found
 *       500:
 *         description: Server error
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

    const order = await DatabaseService.getPolyswapOrderById(orderId);
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateOrderAction(request, params, {
      action: "cancel_draft",
      apiError,
      rejectOrder: (order) =>
        order.status === "draft"
          ? null
          : {
              status: 400,
              error:
                "Only drafts can be deleted off-chain. Live orders must be removed via ComposableCoW.remove(orderHash).",
            },
    });
    if ("response" in auth) return auth.response;
    const { orderId, order } = auth;

    await DatabaseService.deletePolyswapOrderById(orderId);

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: order.owner.toLowerCase(),
      event: "swap_draft_cancelled",
      properties: { order_id: orderId },
    });
    await posthog.flush();

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError({ status: 500, error: "Failed to delete draft order", cause: error });
  }
}
