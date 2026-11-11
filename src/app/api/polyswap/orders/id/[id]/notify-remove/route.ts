import { type NextRequest, NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import type { PolyswapOrderRow } from "@/backend/interfaces/PolyswapOrder";
import { resolveOrder } from "@/backend/orders/orderActionAuth";
import { isSingleOrderAuthed } from "@/backend/rpc/composableCow";
import { orderRepository } from "@/backend/db/orderRepository";
import { createApiErrorResponder, type ApiErrorOptions } from "@/server/apiError";
import { getPostHogClient } from "@/server/posthog";

const apiError = createApiErrorResponder("api-order-notify-remove");

function rejectUnremovableOrder(order: PolyswapOrderRow): ApiErrorOptions | null {
  // The listener may have seen the removal first; the POST handler reports success.
  if (order.status === "canceled") return null;
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
 *       Called after `ComposableCoW.remove(orderHash)` has executed. Needs no
 *       signature: only the owner can remove the order, so the route reads
 *       `singleOrders[owner][orderHash]` and flips the row to canceled only when
 *       it is false. A multisig Safe may execute long after it was proposed. The
 *       listener's order-health check applies the same rule within about a
 *       minute when this call is never made.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Cancellation recorded, or the order was already canceled }
 *       400: { description: Invalid id, or the order is not live or has no on-chain hash }
 *       404: { description: Order not found }
 *       409: { description: The order is still active on-chain; retry once remove() is visible }
 *       500: { description: Server error }
 *       502: { description: Unexpected on-chain state for order }
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await resolveOrder(params, { apiError, rejectOrder: rejectUnremovableOrder });
    if ("response" in resolved) return resolved.response;
    const { orderId, order } = resolved;
    if (order.status === "canceled") return NextResponse.json({ success: true });

    // ComposableCoW.remove() emits no event, and Safe-wrapped txs hide the inner call,
    // so we verify removal by reading singleOrders[owner][orderHash] (true after create, false after remove).
    const isStillActive = await isSingleOrderAuthed(
      getAddress(order.owner),
      order.order_hash as Hex
    );

    if (isStillActive === true) {
      return apiError({
        status: 409,
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
