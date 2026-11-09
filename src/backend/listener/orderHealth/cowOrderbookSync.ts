import type { DatabasePolyswapOrder } from "@/backend/interfaces/PolyswapOrder";
import { createLogger } from "@/backend/logger";
import { getPublicClient } from "@/backend/rpc/clients";
import { DEFAULT_API_BASE } from "@/backend/services/cowAppDataService";
import { orderRepository } from "@/backend/db/orderRepository";
import { storeDbOrderUid } from "@/backend/services/orderUidCalculationService";

const log = createLogger("order-health");

const ORDER_STATUS_BY_COW_STATUS = new Map<string, DatabasePolyswapOrder["status"]>([
  ["fulfilled", "filled"],
  ["expired", "expired"],
  ["cancelled", "canceled"],
]);

// Compute + persist the CoW UID when missing (event-time and backfill may have skipped it).
async function ensureOrderUid(order: DatabasePolyswapOrder): Promise<string | null> {
  if (order.order_uid) return order.order_uid;
  if (!order.order_hash || !order.handler) return null;
  try {
    const uid = await storeDbOrderUid(getPublicClient(), order, order.order_hash);
    log.info(`recovered missing order_uid ${uid} for order ${order.id}`);
    return uid;
  } catch (err) {
    log.warn(
      `could not compute order_uid for order ${order.id}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

async function fetchCowOrderStatus(
  order: DatabasePolyswapOrder,
  orderUid: string
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${DEFAULT_API_BASE}/api/v1/orders/${orderUid}`);
  } catch (err) {
    log.warn(`cow.fi fetch failed for order ${order.id}`, err);
    return null;
  }
  // Not yet indexed by CoW — common right after creation; not an error.
  if (res.status === 404) return null;
  if (!res.ok) {
    log.warn(`cow.fi returned ${res.status} for order ${order.id}`);
    return null;
  }
  const json: unknown = await res.json();
  if (typeof json !== "object" || json === null) return null;
  const status = (json as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

// Sync the CoW orderbook status onto our row (fill/expiry/cancel), recovering the UID if missing.
export async function syncCowOrderStatus(order: DatabasePolyswapOrder): Promise<void> {
  const orderUid = await ensureOrderUid(order);
  if (!orderUid) return;

  const cowStatus = await fetchCowOrderStatus(order, orderUid);
  if (cowStatus === null) return;

  await orderRepository.setCowOrderStatus(order.id, cowStatus);

  const orderStatus = ORDER_STATUS_BY_COW_STATUS.get(cowStatus);
  if (orderStatus) await orderRepository.updateOrderStatusById(order.id, orderStatus);
}
