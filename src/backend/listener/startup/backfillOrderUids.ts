import { storeDbOrderUid } from "@/backend/services/orderUidCalculationService";
import { orderRepository } from "@/backend/db/orderRepository";
import { getPublicClient } from "@/backend/rpc/clients";
import { createLogger } from "@/backend/logger";

const log = createLogger("backfill-uids");

/**
 * Backfill CoW Protocol order UIDs for live orders that are missing them.
 * Runs once on startup to recover from any past listener-down windows where
 * orders were marked live but never had their UID computed.
 */
export async function backfillOrderUids(): Promise<void> {
  const client = getPublicClient();

  const ordersWithoutUid = await orderRepository.getLiveOrdersWithoutUid();
  if (ordersWithoutUid.length === 0) {
    log.debug("nothing to backfill");
    return;
  }
  log.info(`backfilling order_uid for ${ordersWithoutUid.length} order(s)`);

  let filled = 0;
  for (const order of ordersWithoutUid) {
    // Without a handler the UID cannot be derived on-chain.
    if (!order.order_hash || !order.handler) continue;
    try {
      await storeDbOrderUid(client, order, order.order_hash);
      filled += 1;
    } catch (err) {
      log.error(`order ${order.id} failed:`, err);
    }
  }
  log.info(`backfilled ${filled}/${ordersWithoutUid.length}`);
}
