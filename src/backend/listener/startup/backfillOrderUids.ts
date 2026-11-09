import { type Address } from "viem";
import { OrderUidCalculationService } from "@/backend/services/orderUidCalculationService";
import { DatabaseService } from "@/backend/services/databaseService";
import { getPublicClient } from "@/backend/rpc/clients";
import { createLogger } from "@/backend/logger";

const log = createLogger("backfill-uids");

/**
 * Backfill CoW Protocol order UIDs for live orders that are missing them.
 * Runs once on startup to recover from any past listener-down windows where
 * orders were marked live but never had their UID computed.
 */
export async function backfillOrderUids(): Promise<void> {
  OrderUidCalculationService.initialize(getPublicClient());

  const ordersWithoutUid = await DatabaseService.getLiveOrdersWithoutUid();
  if (ordersWithoutUid.length === 0) {
    log.debug("nothing to backfill");
    return;
  }
  log.info(`backfilling order_uid for ${ordersWithoutUid.length} order(s)`);

  let filled = 0;
  for (const order of ordersWithoutUid) {
    if (!order.order_hash) continue;
    try {
      const data = OrderUidCalculationService.createPolyswapOrderDataFromDbOrder(order);
      const uid = await OrderUidCalculationService.calculateCompleteOrderUidOnChain(
        data,
        order.owner as Address,
        order.handler as Address
      );
      await DatabaseService.updateOrderUid(order.order_hash, uid);
      filled += 1;
    } catch (err) {
      log.error(`order ${order.id} failed:`, err);
    }
  }
  log.info(`backfilled ${filled}/${ordersWithoutUid.length}`);
}
