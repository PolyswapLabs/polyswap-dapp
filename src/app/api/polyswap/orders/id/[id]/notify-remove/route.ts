import { type NextRequest, NextResponse } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import composableCowAbi from "@/abi/composableCoW.json";
import { DatabaseService } from "@/backend/services/databaseService";
import { verifySignature } from "@/backend/utils/signatureVerification";
import { getPublicClient } from "@/backend/listener/blockchainProvider";
import { createApiErrorResponder } from "@/lib/apiError";
import { getPostHogClient } from "@/lib/posthog-server";

const apiError = createApiErrorResponder("api-order-notify-remove");

const COMPOSABLE_COW: Address = getAddress(
  process.env.COMPOSABLE_COW ?? "0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74"
);

interface NotifyRemoveBody {
  signature: string;
  timestamp: number;
}

function isNotifyBody(value: unknown): value is NotifyRemoveBody {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.signature === "string" && typeof v.timestamp === "number";
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
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return apiError({ status: 400, error: "Invalid order id" });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return apiError({ status: 400, error: "Invalid JSON body", cause: error });
    }
    if (!isNotifyBody(body)) {
      return apiError({
        status: 400,
        error: "Invalid request body",
        message: "Body must include { signature: string, timestamp: number }",
      });
    }

    const order = await DatabaseService.getPolyswapOrderById(orderId);
    if (!order) {
      return apiError({ status: 404, error: "Order not found" });
    }
    if (order.status !== "live") {
      return apiError({ status: 400, error: "Only live orders can be notified for removal" });
    }
    if (!order.order_hash) {
      return apiError({
        status: 400,
        error: "Order has no on-chain hash yet; cannot verify removal",
      });
    }

    const publicClient = getPublicClient();
    const verification = await verifySignature({
      action: "notify_remove",
      orderIdentifier: String(orderId),
      timestamp: body.timestamp,
      chainId: 137,
      signature: body.signature,
      expectedAddress: order.owner,
      publicClient,
    });
    if (!verification.valid) {
      return apiError({ status: 401, error: verification.error ?? "Unauthorized" });
    }

    // ComposableCoW.remove() emits no event, and Safe-wrapped txs hide the inner call,
    // so we verify removal by reading singleOrders[owner][orderHash] (true after create, false after remove).
    const isStillActive = await publicClient.readContract({
      address: COMPOSABLE_COW,
      abi: composableCowAbi,
      functionName: "singleOrders",
      args: [getAddress(order.owner), order.order_hash as Hex],
    });

    if (isStillActive === true) {
      return apiError({
        status: 400,
        error: "Order is still active on-chain. Send remove() first.",
      });
    }
    if (isStillActive !== false) {
      return apiError({ status: 502, error: "Unexpected on-chain state for order" });
    }

    await DatabaseService.updateOrderStatusById(orderId, "canceled");

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
