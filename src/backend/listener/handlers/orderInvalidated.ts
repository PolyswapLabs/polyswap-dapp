import { decodeEventLog, type Log, type Hex, type Address } from "viem";
import gpv2Abi from "@/abi/GPV2Settlement.json";
import { orderRepository } from "@/backend/db/orderRepository";
import { createLogger } from "@/backend/logger";
import { isMinedLog } from "@/backend/listener/events";

const log = createLogger("order-invalidated");

interface DecodedOrderInvalidated {
  owner: Address;
  orderUid: Hex;
}

function decodeLog(log: Log): DecodedOrderInvalidated | null {
  const decoded = decodeEventLog({
    abi: gpv2Abi,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== "OrderInvalidated") return null;
  return decoded.args as unknown as DecodedOrderInvalidated;
}

export async function handleOrderInvalidated(eventLog: Log): Promise<void> {
  const decoded = decodeLog(eventLog);
  if (!decoded) return;
  if (!isMinedLog(eventLog)) return;

  const order = await orderRepository.getPolyswapOrderByUid(decoded.orderUid);
  if (!order) return;
  if (order.status === "canceled" || order.status === "filled") {
    log.debug(`order ${order.id} already terminal (${order.status}); skipping`);
    return;
  }

  // The fill* columns record the settling transaction, here the cancellation.
  await orderRepository.updateOrderStatusById(order.id, "canceled", {
    fillTransactionHash: eventLog.transactionHash,
    fillBlockNumber: Number(eventLog.blockNumber),
    fillLogIndex: Number(eventLog.logIndex),
  });
  log.info(`order ${order.id} canceled (uid ${decoded.orderUid})`);
}

/**
 * For WebSocket events only. Live events do not advance the saved block, so a
 * failure here is replayed by the next restart's catch-up. Catch-up itself must
 * call handleOrderInvalidated, or it could save a block past a failed event.
 */
export async function handleLiveOrderInvalidated(eventLog: Log): Promise<void> {
  try {
    await handleOrderInvalidated(eventLog);
  } catch (error) {
    log.error("live event failed; the next restart replays it:", error);
  }
}
