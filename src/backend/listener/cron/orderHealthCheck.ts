import { zeroHash, type Address, type Hex } from "viem";
import type { DatabasePolyswapOrder } from "@/backend/interfaces/PolyswapOrder";
import { syncCowOrderStatus } from "@/backend/listener/orderHealth/cowOrderbookSync";
import { expireIfNeeded } from "@/backend/listener/orderHealth/expiry";
import { extractRevertData, recordRevert } from "@/backend/listener/orderHealth/revertClassifier";
import { createLogger } from "@/backend/logger";
import { assertOrderTradeable } from "@/backend/rpc/composableCow";
import { DatabaseService } from "@/backend/services/databaseService";
import { activateSentinel } from "@/backend/services/polymarketSentinelService";
import { encodeStaticInput } from "@/backend/utils/conditionalOrderCodec";
import { createIntervalJob } from "./intervalJob";

const log = createLogger("order-health");

/**
 * Reconstruct staticInput from a DB row, byte-identical to the on-chain commit (else H(params)
 * mismatches → SingleOrderNotAuthed). Pre-makerAmount orders have a null column → legacy 9-field layout.
 */
export function reconstructStaticInput(order: DatabasePolyswapOrder): Hex {
  return encodeStaticInput({
    sellToken: order.sell_token as Address,
    buyToken: order.buy_token as Address,
    receiver: order.owner as Address,
    sellAmount: BigInt(order.sell_amount),
    minBuyAmount: BigInt(order.min_buy_amount),
    t0: BigInt(Math.floor(new Date(order.start_time).getTime() / 1000)),
    t: BigInt(Math.floor(new Date(order.end_time).getTime() / 1000)),
    polymarketOrderHash: (order.polymarket_order_hash ?? zeroHash) as Hex,
    appData: (order.app_data ?? zeroHash) as Hex,
    polymarketMakerAmount:
      order.polymarket_maker_amount == null ? null : BigInt(order.polymarket_maker_amount),
  });
}

/** Returns false when the retry failed and this order should wait for the next tick. */
async function retrySentinelActivation(order: DatabasePolyswapOrder): Promise<boolean> {
  if (order.sentinel_id === null || !order.transaction_hash) return true;
  try {
    await activateSentinel(order.sentinel_id, order.transaction_hash, {
      handler: order.handler,
      polymarketOrderHash: order.polymarket_order_hash,
      makerAmount: order.polymarket_maker_amount,
    });
    return true;
  } catch (error) {
    log.warn(`sentinel activation retry failed for order ${order.id}`, error);
    return false;
  }
}

// The first success opens the gate, which lets the UI distinguish "still waiting for trigger"
// from "trigger fired, waiting for the swap to settle".
async function markFillable(order: DatabasePolyswapOrder): Promise<void> {
  await DatabaseService.clearOrderError(order.id);
  if (!order.gate_opened_at) {
    await DatabaseService.markGateOpened(order.id);
    await DatabaseService.markSentinelFilledForOrder(order.id);
  }
}

async function checkTradeability(order: DatabasePolyswapOrder): Promise<void> {
  // Without these the conditional-order params can't be reconstructed.
  if (!order.handler || !order.salt) return;

  if (await expireIfNeeded(order)) return;
  if (!(await retrySentinelActivation(order))) return;

  const params = {
    handler: order.handler as Address,
    salt: order.salt as Hex,
    staticInput: reconstructStaticInput(order),
  };

  try {
    await assertOrderTradeable(order.owner as Address, params);
    await markFillable(order);
  } catch (err) {
    const data = extractRevertData(err);
    if (!data) {
      log.error(`unrecognised error for order ${order.id}`, err);
      return;
    }
    await recordRevert(order, data);
  }
}

async function runOrderHealthCheck(): Promise<void> {
  const live = await DatabaseService.getLiveOrders();
  if (live.length === 0) {
    log.debug("no live orders to check");
    return;
  }
  log.debug(`checking ${live.length} live order(s)`);
  for (const order of live) {
    try {
      await checkTradeability(order);
      await syncCowOrderStatus(order);
    } catch (err) {
      log.error(`order ${order.id} crashed`, err);
    }
  }
}

const job = createIntervalJob("order-health", runOrderHealthCheck);

export function startOrderHealthCheck(intervalSeconds = 60): void {
  job.start(intervalSeconds * 1000);
  log.debug(`every ${intervalSeconds}s`);
}

export const stopOrderHealthCheck = job.stop;
