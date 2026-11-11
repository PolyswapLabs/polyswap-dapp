import type { NextResponse } from "next/server";
import type { PolyswapOrderRow } from "@/backend/interfaces/PolyswapOrder";
import { orderRepository } from "@/backend/db/orderRepository";
import type { ApiErrorOptions, ApiErrorResponder } from "@/server/apiError";

interface OrderRules {
  apiError: ApiErrorResponder;
  /** Rejects an order in the wrong state for the action. */
  rejectOrder: (order: PolyswapOrderRow) => ApiErrorOptions | null;
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

/** Resolves the order behind an action the chain itself authorises, or the error response. */
export async function resolveOrder(
  params: Promise<{ id: string }>,
  { apiError, rejectOrder }: OrderRules
): Promise<Resolution> {
  const orderId = parseOrderId((await params).id, apiError);
  if (typeof orderId !== "number") return orderId;

  const order = await orderRepository.getPolyswapOrderById(orderId);
  if (!order) {
    return { response: apiError({ status: 404, error: "Order not found" }) };
  }
  const rejection = rejectOrder(order);
  if (rejection) return { response: apiError(rejection) };
  return { orderId, order };
}
