import type { PolyswapOrderRow } from "@/backend/interfaces/PolyswapOrder";
import { createLogger } from "@/backend/logger";
import { orderRepository } from "@/backend/db/orderRepository";
import { gammaApi } from "@/backend/polymarket/gamma";

const log = createLogger("order-health");

// Explicit deadline → end_time; otherwise expired only once the market is resolved.
async function isExpired(order: PolyswapOrderRow): Promise<boolean> {
  const deadlinePassed = new Date(order.end_time).getTime() <= Date.now();
  if (order.explicit_deadline || !order.market_id) return deadlinePassed;
  return gammaApi.isMarketClosed(order.market_id);
}

export async function expireIfNeeded(order: PolyswapOrderRow): Promise<boolean> {
  if (!(await isExpired(order))) return false;
  log.info(
    `order ${order.id} expired (${order.explicit_deadline ? "deadline passed" : "market resolved"})`
  );
  await orderRepository.updateOrderStatusById(order.id, "expired");
  return true;
}
