import type { NextRequest, NextResponse } from "next/server";
import type { DatabasePolyswapOrder } from "@/backend/interfaces/PolyswapOrder";
import { getPublicClient } from "@/backend/rpc/clients";
import { DatabaseService } from "@/backend/services/databaseService";
import { verifySignature } from "@/backend/utils/signatureVerification";
import type { ApiErrorOptions, ApiErrorResponder } from "@/lib/apiError";

interface SignedActionBody {
  signature: string;
  timestamp: number;
}

function isSignedActionBody(value: unknown): value is SignedActionBody {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.signature === "string" && typeof v.timestamp === "number";
}

interface OrderActionRules {
  action: "cancel_draft" | "notify_remove";
  apiError: ApiErrorResponder;
  /** Checked before the signature, so an order in the wrong state is reported first. */
  rejectOrder: (order: DatabasePolyswapOrder) => ApiErrorOptions | null;
}

interface AuthenticatedOrderAction {
  orderId: number;
  order: DatabasePolyswapOrder;
}

/** Resolves the order behind a signed action, or the error response to send instead. */
export async function authenticateOrderAction(
  request: NextRequest,
  params: Promise<{ id: string }>,
  { action, apiError, rejectOrder }: OrderActionRules
): Promise<AuthenticatedOrderAction | { response: NextResponse }> {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { response: apiError({ status: 400, error: "Invalid order id" }) };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return { response: apiError({ status: 400, error: "Invalid JSON body", cause: error }) };
  }
  if (!isSignedActionBody(body)) {
    return {
      response: apiError({
        status: 400,
        error: "Invalid request body",
        message: "Body must include { signature: string, timestamp: number }",
      }),
    };
  }

  const order = await DatabaseService.getPolyswapOrderById(orderId);
  if (!order) {
    return { response: apiError({ status: 404, error: "Order not found" }) };
  }
  const rejection = rejectOrder(order);
  if (rejection) return { response: apiError(rejection) };

  const verification = await verifySignature({
    action,
    orderIdentifier: String(orderId),
    timestamp: body.timestamp,
    chainId: 137,
    signature: body.signature,
    expectedAddress: order.owner,
    publicClient: getPublicClient(),
  });
  if (!verification.valid) {
    return { response: apiError({ status: 401, error: verification.error ?? "Unauthorized" }) };
  }

  return { orderId, order };
}
