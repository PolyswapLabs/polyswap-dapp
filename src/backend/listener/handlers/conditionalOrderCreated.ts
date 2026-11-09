import { decodeEventLog, type Address, type Hex, type Log, type PublicClient } from "viem";
import composableCowAbi from "@/abi/composableCoW.json";
import { reportSkippedOrder } from "@/backend/errorReporting";
import type { ConditionalOrderParams, PolyswapOrderData } from "@/backend/interfaces/PolyswapOrder";
import { type EventHandlingOptions, isMinedLog, type MinedLog } from "@/backend/listener/events";
import { createLogger } from "@/backend/logger";
import { getAcceptedPolyswapHandlers } from "@/backend/polymarket/config";
import { getPublicClient } from "@/backend/rpc/clients";
import { DatabaseService } from "@/backend/services/databaseService";
import { storeOrderUid } from "@/backend/services/orderUidCalculationService";
import { activateSentinel } from "@/backend/services/polymarketSentinelService";
import { calculateOrderHash, decodeStaticInput } from "@/backend/utils/conditionalOrderCodec";
import { readPositiveInt } from "@/backend/utils/env";

const log = createLogger("conditional-order");

interface DecodedConditionalOrderCreated {
  owner: Address;
  params: ConditionalOrderParams;
}

interface AcceptedOrder extends DecodedConditionalOrderCreated {
  orderHash: string;
  data: PolyswapOrderData;
}

type PersistedOrder = Awaited<ReturnType<typeof DatabaseService.upsertLiveOrderFromEvent>>;

function decodeLog(log: Log): DecodedConditionalOrderCreated | null {
  const decoded = decodeEventLog({
    abi: composableCowAbi,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== "ConditionalOrderCreated") return null;
  // viem types decoded.args as a tuple/object based on the ABI; cast through
  // a narrowed shape after eventName matches.
  const args = decoded.args as unknown as {
    owner: Address;
    params: { handler: Address; salt: Hex; staticInput: Hex };
  };
  return {
    owner: args.owner,
    params: {
      handler: args.params.handler,
      salt: args.params.salt,
      staticInput: args.params.staticInput,
    },
  };
}

function readOwnHandlers(): ReadonlySet<string> {
  return new Set(getAcceptedPolyswapHandlers().map((address) => address.toLowerCase()));
}

function isOwnHandler(handler: string, ownHandlers: ReadonlySet<string>): boolean {
  if (ownHandlers.has(handler.toLowerCase())) return true;
  log.debug(`skipping event for foreign handler ${handler}`);
  return false;
}

async function waitForSafeAuthorization(
  client: PublicClient,
  transactionHash: Hex
): Promise<boolean> {
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: readPositiveInt("SAFE_AUTH_CONFIRMATIONS", 3),
      timeout: 5 * 60 * 1000,
    });
    if (receipt.status === "success") return true;
    log.warn(`Safe authorization tx ${transactionHash} reverted; skipping`);
    return false;
  } catch (error) {
    log.error(`Safe authorization tx ${transactionHash} was not confirmed:`, error);
    return false;
  }
}

async function persistLiveOrder(
  order: AcceptedOrder,
  eventLog: MinedLog
): Promise<PersistedOrder | null> {
  try {
    const persisted = await DatabaseService.upsertLiveOrderFromEvent({
      owner: order.owner,
      orderHash: order.orderHash,
      handler: order.params.handler,
      salt: order.params.salt,
      data: order.data,
      transactionHash: eventLog.transactionHash,
      blockNumber: Number(eventLog.blockNumber),
      logIndex: Number(eventLog.logIndex),
    });
    log.info(`upserted live order ${order.orderHash} (owner ${order.owner})`);
    return persisted;
  } catch (err) {
    log.error("upsertLiveOrderFromEvent failed:", err);
    return null;
  }
}

async function storeUidOrDeferToBackfill(
  client: PublicClient,
  order: AcceptedOrder
): Promise<void> {
  try {
    const orderUid = await storeOrderUid(client, {
      orderHash: order.orderHash,
      data: order.data,
      owner: order.owner,
      handler: order.params.handler as Address,
    });
    log.debug(`stored order_uid ${orderUid} for ${order.orderHash}`);
  } catch (uidErr) {
    log.warn(
      `order_uid computation failed for ${order.orderHash}; will retry on backfill: ${
        uidErr instanceof Error ? uidErr.message : String(uidErr)
      }`
    );
  }
}

async function activateSentinelIfAllowed(
  order: AcceptedOrder,
  persisted: PersistedOrder,
  authorizationTxHash: Hex,
  options: EventHandlingOptions
): Promise<void> {
  if (!persisted.serverCreated || persisted.sentinelId === null) {
    log.warn(
      `order ${order.orderHash} has no matching server-created sentinel; privileged activation skipped`
    );
    return;
  }
  if (options.allowTrading !== true) {
    log.debug(`sentinel activation disabled for order ${order.orderHash} in listener-only mode`);
    return;
  }
  try {
    await activateSentinel(persisted.sentinelId, authorizationTxHash, {
      handler: order.params.handler,
      polymarketOrderHash: order.data.polymarketOrderHash,
      makerAmount: order.data.polymarketMakerAmount,
    });
  } catch (err) {
    // The sentinel remains prepared and can be retried by the health check.
    log.error(`sentinel activation failed for order ${order.orderHash}:`, err);
  }
}

async function processConditionalOrderCreated(
  eventLog: Log,
  options: EventHandlingOptions
): Promise<void> {
  const ownHandlers = readOwnHandlers();
  if (ownHandlers.size === 0) {
    log.error("no Polyswap handler configured; skipping event");
    return;
  }

  const decoded = decodeLog(eventLog);
  if (!decoded || !isOwnHandler(decoded.params.handler, ownHandlers)) return;

  if (!isMinedLog(eventLog)) {
    log.error("event missing block/tx/index — skipping");
    return;
  }

  const order: AcceptedOrder = {
    ...decoded,
    orderHash: calculateOrderHash(decoded.params),
    data: decodeStaticInput(decoded.params.staticInput as Hex),
  };
  log.debug(
    `accepted owner=${order.owner} orderHash=${order.orderHash} block=${eventLog.blockNumber}`
  );

  const client = getPublicClient();
  if (!(await waitForSafeAuthorization(client, eventLog.transactionHash))) return;

  const persisted = await persistLiveOrder(order, eventLog);
  if (!persisted) return;

  await storeUidOrDeferToBackfill(client, order);
  await activateSentinelIfAllowed(order, persisted, eventLog.transactionHash, options);
}

/**
 * Treat each on-chain event as its own failure boundary. A malformed payload or
 * any other unexpected per-order error is reported, then skipped without
 * aborting historical catch-up or leaking an unhandled WebSocket rejection.
 */
export async function handleConditionalOrderCreated(
  eventLog: Log,
  options: EventHandlingOptions = {}
): Promise<void> {
  try {
    await processConditionalOrderCreated(eventLog, options);
  } catch (error) {
    reportSkippedOrder(error, eventLog);
  }
}
