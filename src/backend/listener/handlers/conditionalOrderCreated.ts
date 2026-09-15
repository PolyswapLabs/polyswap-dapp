import { randomUUID } from "node:crypto";
import Sentry from "@sentry/nextjs";
import { decodeEventLog, type Log, type Hex, type Address } from "viem";
import composableCowAbi from "@/abi/composableCoW.json";
import { DatabaseService } from "@/backend/services/databaseService";
import { OrderUidCalculationService } from "@/backend/services/orderUidCalculationService";
import { getPublicClient } from "../blockchainProvider";
import { calculateOrderHash, decodeStaticInput } from "../eventDecoder";
import type { ConditionalOrderParams } from "@/backend/interfaces/PolyswapOrder";
import { createLogger } from "@/backend/logger";
import { activateSentinel } from "@/backend/services/polymarketSentinelService";

const log = createLogger("conditional-order");

function toReportableError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error).slice(0, 1_000));

  const shortMessage = (error as Error & { shortMessage?: unknown }).shortMessage;
  const message =
    typeof shortMessage === "string"
      ? shortMessage
      : (error.message.split("\n", 1)[0] ?? error.name);
  const reportable = new Error(message.slice(0, 1_000));
  reportable.name = error.name;

  // Viem decoding errors embed the complete invalid calldata in their message.
  // Keep useful stack frames without forwarding an attacker-controlled blob.
  const frames = error.stack?.split("\n").filter((line) => line.trimStart().startsWith("at "));
  if (frames?.length) {
    reportable.stack = `${reportable.name}: ${reportable.message}\n${frames.join("\n")}`;
  }

  return reportable;
}

function reportSkippedOrder(error: unknown, eventLog: Log): void {
  const errorId = randomUUID();
  const normalizedError = toReportableError(error);
  const eventContext = {
    errorId,
    errorType: normalizedError.name,
    transactionHash: eventLog.transactionHash ?? "unknown",
    blockNumber: eventLog.blockNumber?.toString() ?? "unknown",
    logIndex: eventLog.logIndex?.toString() ?? "unknown",
  };

  let sentryEventId: string | undefined;
  try {
    Sentry.withScope((scope) => {
      scope.setLevel("error");
      scope.setTag("error_id", errorId);
      scope.setTag("listener", "conditional-order");
      scope.setContext("conditional_order_event", eventContext);
      sentryEventId = Sentry.captureException(normalizedError);
    });
  } catch (sentryError) {
    log.error("Sentry capture failed", { errorId }, sentryError);
  }

  log.error(
    `conditional order skipped after processing error (errorId=${errorId})`,
    { ...eventContext, sentryEventId },
    normalizedError
  );
}

function safeAuthConfirmations(): number {
  const parsed = Number.parseInt(process.env.SAFE_AUTH_CONFIRMATIONS ?? "3", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3;
}

interface DecodedConditionalOrderCreated {
  owner: Address;
  params: ConditionalOrderParams;
}

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

async function processConditionalOrderCreated(
  eventLog: Log,
  options: { allowTrading?: boolean } = {}
): Promise<void> {
  const standardHandler = process.env.NEXT_PUBLIC_POLYSWAP_HANDLER;
  const negRiskHandler = process.env.NEXT_PUBLIC_POLYSWAP_HANDLER_NEGRISK;
  if (!standardHandler && !negRiskHandler) {
    log.error("no Polyswap handler configured; skipping event");
    return;
  }
  const ownHandlers = new Set(
    [standardHandler, negRiskHandler]
      .filter((h): h is string => Boolean(h))
      .map((h) => h.toLowerCase())
  );

  const decoded = decodeLog(eventLog);
  if (!decoded) return;

  if (!ownHandlers.has(decoded.params.handler.toLowerCase())) {
    log.debug(`skipping event for foreign handler ${decoded.params.handler}`);
    return;
  }

  if (
    eventLog.transactionHash === null ||
    eventLog.blockNumber === null ||
    eventLog.logIndex === null
  ) {
    log.error("event missing block/tx/index — skipping");
    return;
  }

  const orderHash = calculateOrderHash(decoded.params);
  const data = decodeStaticInput(decoded.params.staticInput as Hex);
  log.debug(`accepted owner=${decoded.owner} orderHash=${orderHash} block=${eventLog.blockNumber}`);

  const client = getPublicClient();
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: eventLog.transactionHash,
      confirmations: safeAuthConfirmations(),
      timeout: 5 * 60 * 1000,
    });
    if (receipt.status !== "success") {
      log.warn(`Safe authorization tx ${eventLog.transactionHash} reverted; skipping`);
      return;
    }
  } catch (error) {
    log.error(`Safe authorization tx ${eventLog.transactionHash} was not confirmed:`, error);
    return;
  }

  let persisted: { orderId: number; sentinelId: number | null; serverCreated: boolean } | undefined;
  try {
    persisted = await DatabaseService.upsertLiveOrderFromEvent({
      owner: decoded.owner,
      orderHash,
      handler: decoded.params.handler,
      salt: decoded.params.salt,
      data,
      transactionHash: eventLog.transactionHash,
      blockNumber: Number(eventLog.blockNumber),
      logIndex: Number(eventLog.logIndex),
    });
    log.info(`upserted live order ${orderHash} (owner ${decoded.owner})`);

    // Persist the CoW UID now — both fill-detection paths look orders up by it.
    try {
      OrderUidCalculationService.initialize(client);
      const orderUid = await OrderUidCalculationService.calculateCompleteOrderUidOnChain(
        data,
        decoded.owner,
        decoded.params.handler as Address
      );
      await DatabaseService.updateOrderUid(orderHash, orderUid);
      log.debug(`stored order_uid ${orderUid} for ${orderHash}`);
    } catch (uidErr) {
      log.warn(
        `order_uid computation failed for ${orderHash}; will retry on backfill: ${
          uidErr instanceof Error ? uidErr.message : String(uidErr)
        }`
      );
    }
  } catch (err) {
    log.error("upsertLiveOrderFromEvent failed:", err);
    return;
  }

  if (persisted.serverCreated && persisted.sentinelId !== null && options.allowTrading === true) {
    try {
      await activateSentinel(persisted.sentinelId, eventLog.transactionHash);
    } catch (err) {
      // The sentinel remains prepared and can be retried by the health check.
      log.error(`sentinel activation failed for order ${orderHash}:`, err);
    }
  } else if (!persisted.serverCreated || persisted.sentinelId === null) {
    log.warn(
      `order ${orderHash} has no matching server-created sentinel; privileged activation skipped`
    );
  } else {
    log.debug(`sentinel activation disabled for order ${orderHash} in listener-only mode`);
  }
}

/**
 * Treat each on-chain event as its own failure boundary. A malformed payload or
 * any other unexpected per-order error is reported, then skipped without
 * aborting historical catch-up or leaking an unhandled WebSocket rejection.
 */
export async function handleConditionalOrderCreated(
  eventLog: Log,
  options: { allowTrading?: boolean } = {}
): Promise<void> {
  try {
    await processConditionalOrderCreated(eventLog, options);
  } catch (error) {
    reportSkippedOrder(error, eventLog);
  }
}
