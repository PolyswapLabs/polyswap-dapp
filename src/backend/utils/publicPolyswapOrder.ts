import type { PolyswapOrderRow, PublicPolyswapOrder } from "@/backend/interfaces/PolyswapOrder";

/** Keep the public API aligned with the fields consumed by the current UI. */
export function toPublicPolyswapOrder(order: PolyswapOrderRow): PublicPolyswapOrder {
  return {
    id: order.id,
    order_hash: order.order_hash,
    sell_token: order.sell_token,
    buy_token: order.buy_token,
    sell_amount: order.sell_amount,
    start_time: order.start_time.toISOString(),
    end_time: order.end_time.toISOString(),
    market_id: order.market_id,
    outcome_selected: order.outcome_selected,
    bet_percentage: order.bet_percentage,
    status: order.status,
    order_uid: order.order_uid,
    last_error_reason: order.last_error_reason,
    last_error_retry_at: order.last_error_retry_at,
    filled_at: order.filled_at?.toISOString() ?? null,
    gate_opened_at: order.gate_opened_at?.toISOString() ?? null,
    actual_sell_amount: order.actual_sell_amount,
    actual_buy_amount: order.actual_buy_amount,
  };
}
