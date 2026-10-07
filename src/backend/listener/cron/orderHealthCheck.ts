import {
  type Address,
  type Hex,
  ContractFunctionExecutionError,
  decodeErrorResult,
  encodeAbiParameters,
  getAddress,
} from "viem";
import { getPublicClient } from "../blockchainProvider";
import { decodePollError, type CowConditionalErrorName } from "../eventDecoder";
import { DatabaseService } from "@/backend/services/databaseService";
import { OrderUidCalculationService } from "@/backend/services/orderUidCalculationService";
import { PolymarketAPIService } from "@/backend/services/polymarketAPIService";
import composableCowAbi from "@/abi/composableCoW.json";
import type { DatabasePolyswapOrder } from "@/backend/interfaces/PolyswapOrder";
import { createLogger } from "@/backend/logger";
import { activateSentinel } from "@/backend/services/polymarketSentinelService";

const log = createLogger("order-health");

const COMPOSABLE_COW: Address = getAddress(
  process.env.COMPOSABLE_COW ?? "0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74"
);

const TERMINAL_ERRORS: ReadonlySet<CowConditionalErrorName> = new Set([
  "OrderNotValid",
  "PollNever",
]);

const COMPOSABLE_COW_ERROR_ABI = [
  { type: "error", name: "SingleOrderNotAuthed", inputs: [] },
  { type: "error", name: "ProofNotAuthed", inputs: [] },
  { type: "error", name: "InterfaceNotSupported", inputs: [] },
  { type: "error", name: "SwapGuardRestricted", inputs: [] },
  { type: "error", name: "InvalidFallbackHandler", inputs: [] },
] as const;

const COW_ERROR_REASONS: Record<string, string> = {
  SingleOrderNotAuthed:
    "Conditional order not authorised on-chain (params don't match, or order removed)",
  ProofNotAuthed: "Merkle proof not authorised on-chain",
  InterfaceNotSupported: "Handler does not implement IConditionalOrderGenerator",
  SwapGuardRestricted: "Blocked by the Safe's swap guard",
  InvalidFallbackHandler: "Safe is missing CoW's ExtensibleFallbackHandler",
};

const TERMINAL_COW_ERRORS: ReadonlySet<string> = new Set([
  "ProofNotAuthed",
  "InterfaceNotSupported",
]);

const COMPOSABLE_COW_AUTH_ABI = [
  {
    type: "function",
    name: "singleOrders",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

function decodeComposableCowError(data: Hex): string | null {
  try {
    return decodeErrorResult({ abi: COMPOSABLE_COW_ERROR_ABI, data }).errorName;
  } catch {
    return null;
  }
}

// false = removed on-chain by the owner (cancel); true = still authed (reconstruction drift).
async function classifySingleOrderNotAuthed(
  order: DatabasePolyswapOrder
): Promise<"canceled" | "reconstruction-mismatch" | "unknown"> {
  if (!order.order_hash) return "unknown";
  try {
    const authed = await getPublicClient().readContract({
      address: COMPOSABLE_COW,
      abi: COMPOSABLE_COW_AUTH_ABI,
      functionName: "singleOrders",
      args: [order.owner as Address, order.order_hash as Hex],
    });
    return authed ? "reconstruction-mismatch" : "canceled";
  } catch (err) {
    log.warn(
      `order ${order.id}: singleOrders read failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return "unknown";
  }
}

const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}` as Hex;

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

const ORDER_DATA_TUPLE = [
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "bytes32" },
  { type: "bytes32" },
] as const;

const ORDER_DATA_TUPLE_V2 = [...ORDER_DATA_TUPLE, { type: "uint256" }] as const;

/**
 * Reconstruct staticInput from a DB row, byte-identical to the on-chain commit (else H(params)
 * mismatches → SingleOrderNotAuthed). Pre-makerAmount orders have a null column → legacy 9-field layout.
 */
function reconstructStaticInput(order: DatabasePolyswapOrder): Hex {
  const base = [
    order.sell_token as Address,
    order.buy_token as Address,
    order.owner as Address,
    BigInt(order.sell_amount),
    BigInt(order.min_buy_amount),
    BigInt(Math.floor(new Date(order.start_time).getTime() / 1000)),
    BigInt(Math.floor(new Date(order.end_time).getTime() / 1000)),
    (order.polymarket_order_hash ?? ZERO_BYTES32) as Hex,
    (order.app_data ?? ZERO_BYTES32) as Hex,
  ] as const;

  if (order.polymarket_maker_amount == null) {
    return encodeAbiParameters(ORDER_DATA_TUPLE, base);
  }
  return encodeAbiParameters(ORDER_DATA_TUPLE_V2, [...base, BigInt(order.polymarket_maker_amount)]);
}

// Explicit deadline → end_time; otherwise expired only once the market is resolved.
async function expireIfNeeded(order: DatabasePolyswapOrder): Promise<boolean> {
  const deadlinePassed = new Date(order.end_time).getTime() <= Date.now();
  let expired: boolean;
  if (order.explicit_deadline) {
    expired = deadlinePassed;
  } else if (order.market_id) {
    expired = await PolymarketAPIService.isMarketClosed(order.market_id);
  } else {
    expired = deadlinePassed;
  }
  if (!expired) return false;
  log.info(
    `order ${order.id} expired (${order.explicit_deadline ? "deadline passed" : "market resolved"})`
  );
  await DatabaseService.updateOrderStatusById(order.id, "expired");
  return true;
}

async function checkOne(order: DatabasePolyswapOrder): Promise<void> {
  if (!order.handler || !order.salt) {
    // Missing scaffold needed to reconstruct conditional-order params.
    return;
  }

  if (await expireIfNeeded(order)) return;

  if (order.sentinel_id !== null && order.transaction_hash) {
    try {
      await activateSentinel(order.sentinel_id, order.transaction_hash);
    } catch (error) {
      log.warn(`sentinel activation retry failed for order ${order.id}`, error);
      return;
    }
  }

  const client = getPublicClient();
  const params = {
    handler: order.handler as Address,
    salt: order.salt as Hex,
    staticInput: reconstructStaticInput(order),
  };

  try {
    await client.readContract({
      address: COMPOSABLE_COW,
      abi: composableCowAbi,
      functionName: "getTradeableOrderWithSignature",
      args: [order.owner as Address, params, "0x", []],
    });
    // Success: order is currently fillable. Clear any prior error state, and
    // mark the gate as opened the first time we see this transition — that
    // lets the UI distinguish "still waiting for trigger" from "trigger
    // fired, waiting for the swap to settle".
    await DatabaseService.clearOrderError(order.id);
    if (!order.gate_opened_at) {
      await DatabaseService.markGateOpened(order.id);
      await DatabaseService.markSentinelFilledForOrder(order.id);
    }
  } catch (err) {
    const data = extractRevertData(err);
    if (!data) {
      log.error(`unrecognised error for order ${order.id}`, err);
      return;
    }

    const decoded = decodePollError(data);
    if (!decoded) {
      const cowError = decodeComposableCowError(data);
      if (cowError === "SingleOrderNotAuthed") {
        const verdict = await classifySingleOrderNotAuthed(order);
        if (verdict === "canceled") {
          log.info(`order ${order.id} removed on-chain by owner → canceled`);
          await DatabaseService.setOrderError(
            order.id,
            "OrderRemoved",
            "Conditional order removed on-chain by the owner",
            null
          );
          await DatabaseService.updateOrderStatusById(order.id, "canceled");
        } else if (verdict === "reconstruction-mismatch") {
          log.warn(
            `order ${order.id}: reconstructed params unauthorised but stored order_hash is authorised; leaving live`
          );
          await DatabaseService.setOrderError(
            order.id,
            "ParamsMismatch",
            "Reconstructed params don't match the authorized order_hash (encoding drift)",
            null
          );
        } else {
          await DatabaseService.setOrderError(
            order.id,
            "SingleOrderNotAuthed",
            COW_ERROR_REASONS.SingleOrderNotAuthed ?? "SingleOrderNotAuthed",
            null
          );
        }
        return;
      }
      if (cowError) {
        await DatabaseService.setOrderError(
          order.id,
          cowError,
          COW_ERROR_REASONS[cowError] ?? cowError,
          null
        );
        if (TERMINAL_COW_ERRORS.has(cowError)) {
          log.warn(`order ${order.id} terminal: ${cowError}`);
          await DatabaseService.updateOrderStatusById(order.id, "errored");
        } else {
          log.debug(`order ${order.id} ${cowError} (non-terminal)`);
        }
        return;
      }
      log.warn(`order ${order.id} unrecognised revert (selector ${data.slice(0, 10)})`);
      await DatabaseService.setOrderError(order.id, "UnknownRevert", "Unknown revert", null);
      return;
    }

    if (
      decoded.name === "PollTryNextBlock" ||
      decoded.name === "PollTryAtBlock" ||
      decoded.name === "PollTryAtEpoch"
    ) {
      // Non-terminal "wait" signals: the conditional gate hasn't fired yet.
      // Persist the latest reason so the UI can surface it, but log at debug.
      log.debug(`order ${order.id} not yet tradeable: ${decoded.name}(${decoded.reason})`);
    } else {
      log.warn(`order ${order.id} ${decoded.name}: ${decoded.reason}`);
    }

    await DatabaseService.setOrderError(
      order.id,
      decoded.name,
      decoded.reason,
      decoded.retryAt ?? null
    );
    if (decoded.name === "OrderNotValid" && decoded.reason === "invalid end date") {
      await DatabaseService.updateOrderStatusById(order.id, "expired");
    } else if (TERMINAL_ERRORS.has(decoded.name)) {
      await DatabaseService.updateOrderStatusById(order.id, "errored");
    }
  }
}

// Prefer cause.raw (hex); cause.data is a decoded object when viem matched the call ABI.
function extractRevertData(err: unknown): Hex | undefined {
  if (!(err instanceof ContractFunctionExecutionError)) return undefined;
  const cause = err.cause as { data?: unknown; raw?: unknown } | undefined;
  if (typeof cause?.raw === "string") return cause.raw as Hex;
  if (typeof cause?.data === "string") return cause.data as Hex;
  return undefined;
}

// Compute + persist the CoW UID when missing (event-time and backfill may have skipped it).
async function ensureOrderUid(order: DatabasePolyswapOrder): Promise<string | null> {
  if (order.order_uid) return order.order_uid;
  if (!order.order_hash || !order.handler) return null;
  try {
    OrderUidCalculationService.initialize(getPublicClient());
    const data = OrderUidCalculationService.createPolyswapOrderDataFromDbOrder(order);
    const uid = await OrderUidCalculationService.calculateCompleteOrderUidOnChain(
      data,
      order.owner as Address,
      order.handler as Address
    );
    await DatabaseService.updateOrderUid(order.order_hash, uid);
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

// Sync the CoW orderbook status onto our row (fill/expiry/cancel), recovering the UID if missing.
async function pollCowOrderbook(order: DatabasePolyswapOrder): Promise<void> {
  const orderUid = await ensureOrderUid(order);
  if (!orderUid) return;
  const url = `https://api.cow.fi/polygon/api/v1/orders/${orderUid}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    log.warn(`cow.fi fetch failed for order ${order.id}`, err);
    return;
  }
  if (res.status === 404) {
    // Not yet indexed by CoW — common right after creation; not an error.
    return;
  }
  if (!res.ok) {
    log.warn(`cow.fi returned ${res.status} for order ${order.id}`);
    return;
  }
  const json: unknown = await res.json();
  if (typeof json !== "object" || json === null) return;
  const status = (json as { status?: unknown }).status;
  if (typeof status !== "string") return;

  await DatabaseService.setCowOrderStatus(order.id, status);

  if (status === "fulfilled") {
    await DatabaseService.updateOrderStatusById(order.id, "filled");
  } else if (status === "expired") {
    await DatabaseService.updateOrderStatusById(order.id, "expired");
  } else if (status === "cancelled") {
    await DatabaseService.updateOrderStatusById(order.id, "canceled");
  }
}

export async function runOrderHealthCheck(): Promise<void> {
  const live = await DatabaseService.getLiveOrders();
  if (live.length === 0) {
    log.debug("no live orders to check");
    return;
  }
  log.debug(`checking ${live.length} live order(s)`);
  for (const order of live) {
    try {
      await checkOne(order);
      await pollCowOrderbook(order);
    } catch (err) {
      log.error(`order ${order.id} crashed`, err);
    }
  }
}

async function runScheduledOrderHealthCheck(): Promise<void> {
  if (isRunning) {
    log.warn("previous check is still running; skipping this tick");
    return;
  }

  isRunning = true;
  try {
    await runOrderHealthCheck();
  } catch (err) {
    log.error("order health check failed; will retry on the next tick", err);
  } finally {
    isRunning = false;
  }
}

export function startOrderHealthCheck(intervalSeconds = 60): void {
  if (timer) return;
  timer = setInterval(() => void runScheduledOrderHealthCheck(), intervalSeconds * 1000);
  log.debug(`every ${intervalSeconds}s`);
}

export function stopOrderHealthCheck(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
