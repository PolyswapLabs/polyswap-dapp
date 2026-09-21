import { type NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "../../../../../../backend/services/databaseService";
import { verifySignature } from "@/backend/utils/signatureVerification";
import { getPublicClient } from "@/backend/listener/blockchainProvider";
import { toPublicPolyswapOrder } from "@/backend/utils/publicPolyswapOrder";
import { createApiErrorResponder } from "@/lib/apiError";
import { getPostHogClient } from "@/lib/posthog-server";

const apiError = createApiErrorResponder("api-order-id");

interface DeleteDraftBody {
  signature: string;
  timestamp: number;
}

function isDeleteBody(value: unknown): value is DeleteDraftBody {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.signature === "string" && typeof v.timestamp === "number";
}

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
    if (!isDeleteBody(body)) {
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
    if (order.status !== "draft") {
      return apiError({
        status: 400,
        error:
          "Only drafts can be deleted off-chain. Live orders must be removed via ComposableCoW.remove(orderHash).",
      });
    }

    const verification = await verifySignature({
      action: "cancel_draft",
      orderIdentifier: String(orderId),
      timestamp: body.timestamp,
      chainId: 137,
      signature: body.signature,
      expectedAddress: order.owner,
      publicClient: getPublicClient(),
    });
    if (!verification.valid) {
      return apiError({ status: 401, error: verification.error ?? "Unauthorized" });
    }

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
