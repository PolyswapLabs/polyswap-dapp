import { decodeEventLog, type Log, type Hex, type Address } from "viem";
import gpv2Abi from "@/abi/GPV2Settlement.json";
import { orderRepository } from "@/backend/db/orderRepository";
import { createLogger } from "@/backend/logger";
import { isMinedLog } from "@/backend/listener/events";

const log = createLogger("trade");

interface DecodedTrade {
  owner: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  buyAmount: bigint;
  feeAmount: bigint;
  orderUid: Hex;
}

function decodeLog(log: Log): DecodedTrade | null {
  const decoded = decodeEventLog({
    abi: gpv2Abi,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== "Trade") return null;
  return decoded.args as unknown as DecodedTrade;
}

/** Returns whether the trade belongs to an order we track. */
export async function handleTrade(eventLog: Log): Promise<boolean> {
  const decoded = decodeLog(eventLog);
  if (!decoded) return false;
  if (!isMinedLog(eventLog)) return false;

  const order = await orderRepository.getPolyswapOrderByUid(decoded.orderUid);
  if (!order) {
    log.debug(`no tracked order for uid ${decoded.orderUid}; skipping`);
    return false;
  }

  await orderRepository.updateOrderStatusById(order.id, "filled", {
    filledAt: new Date(),
    fillTransactionHash: eventLog.transactionHash,
    fillBlockNumber: Number(eventLog.blockNumber),
    fillLogIndex: Number(eventLog.logIndex),
    actualSellAmount: decoded.sellAmount.toString(),
    actualBuyAmount: decoded.buyAmount.toString(),
    feeAmount: decoded.feeAmount.toString(),
  });
  log.info(`order ${order.id} filled (uid ${decoded.orderUid})`);
  return true;
}

/**
 * For WebSocket events only: every CoW trade on Polygon arrives here, and only our
 * own may start a sell. Catch-up must call handleTrade, so a failure stops it from
 * saving a block past the event; a live failure is replayed by the next restart.
 */
export async function handleLiveTrade(eventLog: Log, sell: () => Promise<void>): Promise<void> {
  try {
    if (await handleTrade(eventLog)) await sell();
  } catch (error) {
    log.error("live event failed; the next restart replays it:", error);
  }
}
