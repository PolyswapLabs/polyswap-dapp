import { type NextRequest, NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import type { PolyswapOrderRow } from "@/backend/interfaces/PolyswapOrder";
import { authenticateOrderAction } from "@/backend/orders/orderActionAuth";
import { isSingleOrderAuthed } from "@/backend/rpc/composableCow";
import { orderRepository } from "@/backend/db/orderRepository";
import { createApiErrorResponder, type ApiErrorOptions } from "@/server/apiError";
import { getPostHogClient } from "@/server/posthog";

const apiError = createApiErrorResponder("api-order-notify-remove");

function rejectUnremovableOrder(order: PolyswapOrderRow): ApiErrorOptions | null {
  if (order.status !== "live") {
    return { status: 400, error: "Only live orders can be notified for removal" };
  }
  if (!order.order_hash) {
    return { status: 400, error: "Order has no on-chain hash yet; cannot verify removal" };
  }
  return null;
}

/**
 * @swagger
 * /api/polyswap/orders/id/{id}/notify-remove:
 *   post:
 *     tags: [Orders]
 *     summary: Finalise an on-chain cancel
 *     description: >
 *       Server-side finalisation called after the user has confirmed
 *       `ComposableCoW.remove(orderHash)` on-chain. Verifies an EIP-191
 *       signature over `notify_remove:<orderId>` and flips the row to canceled.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signature, timestamp]
 *             properties:
 *               signature: { type: string, description: "EIP-191 signature (hex)" }
 *               timestamp: { type: integer, description: "Unix seconds; rejected if too far from now" }
 *     responses:
 *       200: { description: Cancellation recorded }
 *       400: { description: Invalid id, body, or order state }
 *       401: { description: Bad signature }
 *       404: { description: Order not found }
 *       500: { description: Server error }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateOrderAction(request, params, {
      action: "notify_remove",
      apiError,
      rejectOrder: rejectUnremovableOrder,
    });
    if ("response" in auth) return auth.response;
    const { orderId, order } = auth;

    // ComposableCoW.remove() emits no event, and Safe-wrapped txs hide the inner call,
    // so we verify removal by reading singleOrders[owner][orderHash] (true after create, false after remove).
    const isStillActive = await isSingleOrderAuthed(
      getAddress(order.owner),
      order.order_hash as Hex
    );

    if (isStillActive === true) {
      return apiError({
        status: 400,
        error: "Order is still active on-chain. Send remove() first.",
      });
    }
    if (isStillActive !== false) {
      return apiError({ status: 502, error: "Unexpected on-chain state for order" });
    }

    await orderRepository.updateOrderStatusById(orderId, "canceled");

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: order.owner.toLowerCase(),
      event: "swap_cancelled",
      properties: { order_id: orderId },
    });
    await posthog.flush();

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError({ status: 500, error: "Failed to finalise order removal", cause: error });
  }
}
