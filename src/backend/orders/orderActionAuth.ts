import type { NextRequest, NextResponse } from "next/server";
import type { PolyswapOrderRow } from "@/backend/interfaces/PolyswapOrder";
import { getPublicClient } from "@/backend/rpc/clients";
import { orderRepository } from "@/backend/db/orderRepository";
import { verifySignature } from "@/backend/utils/signatureVerification";
import type { ApiErrorOptions, ApiErrorResponder } from "@/server/apiError";

interface SignedActionBody {
  signature: string;
  timestamp: number;
}

function isSignedActionBody(value: unknown): value is SignedActionBody {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.signature === "string" && typeof v.timestamp === "number";
}

interface OrderRules {
  apiError: ApiErrorResponder;
  /** Checked before any signature, so an order in the wrong state is reported first. */
  rejectOrder: (order: PolyswapOrderRow) => ApiErrorOptions | null;
}

interface OrderActionRules extends OrderRules {
  action: "cancel_draft";
}

interface ResolvedOrder {
  orderId: number;
  order: PolyswapOrderRow;
}

type Resolution = ResolvedOrder | { response: NextResponse };

function parseOrderId(
  id: string,
  apiError: ApiErrorResponder
): number | { response: NextResponse } {
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { response: apiError({ status: 400, error: "Invalid order id" }) };
  }
  return orderId;
}

async function loadOrder(
  orderId: number,
  { apiError, rejectOrder }: OrderRules
): Promise<Resolution> {
  const order = await orderRepository.getPolyswapOrderById(orderId);
  if (!order) {
    return { response: apiError({ status: 404, error: "Order not found" }) };
  }
  const rejection = rejectOrder(order);
  if (rejection) return { response: apiError(rejection) };
  return { orderId, order };
}

/** Resolves the order behind an action the chain itself authorises, or the error response. */
export async function resolveOrder(
  params: Promise<{ id: string }>,
  rules: OrderRules
): Promise<Resolution> {
  const orderId = parseOrderId((await params).id, rules.apiError);
  if (typeof orderId !== "number") return orderId;
  return loadOrder(orderId, rules);
}

/** Resolves the order behind a signed action, or the error response to send instead. */
export async function authenticateOrderAction(
  request: NextRequest,
  params: Promise<{ id: string }>,
  { action, ...rules }: OrderActionRules
): Promise<Resolution> {
  const { apiError } = rules;
  const orderId = parseOrderId((await params).id, apiError);
  if (typeof orderId !== "number") return orderId;

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

  const resolved = await loadOrder(orderId, rules);
  if ("response" in resolved) return resolved;

  const verification = await verifySignature({
    action,
    orderIdentifier: String(orderId),
    timestamp: body.timestamp,
    chainId: 137,
    signature: body.signature,
    expectedAddress: resolved.order.owner,
    publicClient: getPublicClient(),
  });
  if (!verification.valid) {
    return { response: apiError({ status: 401, error: verification.error ?? "Unauthorized" }) };
  }

  return resolved;
}
