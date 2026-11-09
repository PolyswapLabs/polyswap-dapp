import { ContractFunctionExecutionError, decodeErrorResult, type Address, type Hex } from "viem";
import type { PolyswapOrderRow } from "@/backend/interfaces/PolyswapOrder";
import {
  decodePollError,
  type CowConditionalErrorName,
  type DecodedPollError,
} from "@/backend/listener/orderHealth/pollErrors";
import { createLogger } from "@/backend/logger";
import { isSingleOrderAuthed } from "@/backend/rpc/composableCow";
import { orderRepository } from "@/backend/db/orderRepository";

const log = createLogger("order-health");

interface RevertClassification {
  errorCode: string;
  reason: string;
  retryAt: number | null;
  nextStatus: "canceled" | "errored" | "expired" | null;
  logLevel: "debug" | "info" | "warn" | null;
  /** Appended to `order <id>` in the log line. */
  logDetail: string;
}

type SingleOrderAuthVerdict = "canceled" | "reconstruction-mismatch" | "unknown";

const TERMINAL_POLL_ERRORS: ReadonlySet<CowConditionalErrorName> = new Set([
  "OrderNotValid",
  "PollNever",
]);

// Non-terminal: the conditional gate hasn't fired yet. The reason is still persisted for the UI.
const WAIT_SIGNALS: ReadonlySet<CowConditionalErrorName> = new Set([
  "PollTryNextBlock",
  "PollTryAtBlock",
  "PollTryAtEpoch",
]);

const COMPOSABLE_COW_ERROR_ABI = [
  { type: "error", name: "SingleOrderNotAuthed", inputs: [] },
  { type: "error", name: "ProofNotAuthed", inputs: [] },
  { type: "error", name: "InterfaceNotSupported", inputs: [] },
  { type: "error", name: "SwapGuardRestricted", inputs: [] },
  { type: "error", name: "InvalidFallbackHandler", inputs: [] },
] as const;

const COW_ERROR_REASONS: Record<string, string> = {
  ProofNotAuthed: "Merkle proof not authorised on-chain",
  InterfaceNotSupported: "Handler does not implement IConditionalOrderGenerator",
  SwapGuardRestricted: "Blocked by the Safe's swap guard",
  InvalidFallbackHandler: "Safe is missing CoW's ExtensibleFallbackHandler",
};

const TERMINAL_COW_ERRORS: ReadonlySet<string> = new Set([
  "ProofNotAuthed",
  "InterfaceNotSupported",
]);

const NOT_AUTHED_BY_VERDICT: Record<SingleOrderAuthVerdict, RevertClassification> = {
  canceled: {
    errorCode: "OrderRemoved",
    reason: "Conditional order removed on-chain by the owner",
    retryAt: null,
    nextStatus: "canceled",
    logLevel: "info",
    logDetail: " removed on-chain by owner → canceled",
  },
  "reconstruction-mismatch": {
    errorCode: "ParamsMismatch",
    reason: "Reconstructed params don't match the authorized order_hash (encoding drift)",
    retryAt: null,
    nextStatus: null,
    logLevel: "warn",
    logDetail:
      ": reconstructed params unauthorised but stored order_hash is authorised; leaving live",
  },
  unknown: {
    errorCode: "SingleOrderNotAuthed",
    reason: "Conditional order not authorised on-chain (params don't match, or order removed)",
    retryAt: null,
    nextStatus: null,
    logLevel: null,
    logDetail: "",
  },
};

function decodeComposableCowError(data: Hex): string | null {
  try {
    return decodeErrorResult({ abi: COMPOSABLE_COW_ERROR_ABI, data }).errorName;
  } catch {
    return null;
  }
}

function classifyPollError({ name, reason, retryAt }: DecodedPollError): RevertClassification {
  const isWaiting = WAIT_SIGNALS.has(name);
  const endDatePassed = name === "OrderNotValid" && reason === "invalid end date";
  return {
    errorCode: name,
    reason,
    retryAt: retryAt ?? null,
    nextStatus: endDatePassed ? "expired" : TERMINAL_POLL_ERRORS.has(name) ? "errored" : null,
    logLevel: isWaiting ? "debug" : "warn",
    logDetail: isWaiting ? ` not yet tradeable: ${name}(${reason})` : ` ${name}: ${reason}`,
  };
}

function classifyComposableCowError(errorName: string): RevertClassification {
  const isTerminal = TERMINAL_COW_ERRORS.has(errorName);
  return {
    errorCode: errorName,
    reason: COW_ERROR_REASONS[errorName] ?? errorName,
    retryAt: null,
    nextStatus: isTerminal ? "errored" : null,
    logLevel: isTerminal ? "warn" : "debug",
    logDetail: isTerminal ? ` terminal: ${errorName}` : ` ${errorName} (non-terminal)`,
  };
}

/** The on-chain auth state resolves a SingleOrderNotAuthed revert into its real meaning. */
export function classifySingleOrderNotAuthed(
  verdict: SingleOrderAuthVerdict
): RevertClassification {
  return NOT_AUTHED_BY_VERDICT[verdict];
}

/** Maps revert data to what should happen to the order; SingleOrderNotAuthed stays unresolved. */
export function classifyRevert(data: Hex): RevertClassification {
  const pollError = decodePollError(data);
  if (pollError) return classifyPollError(pollError);

  const cowError = decodeComposableCowError(data);
  if (cowError === "SingleOrderNotAuthed") return classifySingleOrderNotAuthed("unknown");
  if (cowError) return classifyComposableCowError(cowError);

  return {
    errorCode: "UnknownRevert",
    reason: "Unknown revert",
    retryAt: null,
    nextStatus: null,
    logLevel: "warn",
    logDetail: ` unrecognised revert (selector ${data.slice(0, 10)})`,
  };
}

// Prefer cause.raw (hex); cause.data is a decoded object when viem matched the call ABI.
export function extractRevertData(err: unknown): Hex | undefined {
  if (!(err instanceof ContractFunctionExecutionError)) return undefined;
  const cause = err.cause as { data?: unknown; raw?: unknown } | undefined;
  if (typeof cause?.raw === "string") return cause.raw as Hex;
  if (typeof cause?.data === "string") return cause.data as Hex;
  return undefined;
}

// false = removed on-chain by the owner (cancel); true = still authed (reconstruction drift).
async function readSingleOrderAuthVerdict(
  order: PolyswapOrderRow
): Promise<SingleOrderAuthVerdict> {
  if (!order.order_hash) return "unknown";
  try {
    const authed = await isSingleOrderAuthed(order.owner as Address, order.order_hash as Hex);
    if (authed === null) return "unknown";
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

async function resolveSingleOrderAuth(
  order: PolyswapOrderRow,
  classification: RevertClassification
): Promise<RevertClassification> {
  if (classification.errorCode !== "SingleOrderNotAuthed") return classification;
  return classifySingleOrderNotAuthed(await readSingleOrderAuthVerdict(order));
}

export async function recordRevert(order: PolyswapOrderRow, data: Hex): Promise<void> {
  const { errorCode, reason, retryAt, nextStatus, logLevel, logDetail } =
    await resolveSingleOrderAuth(order, classifyRevert(data));

  if (logLevel) log[logLevel](`order ${order.id}${logDetail}`);
  await orderRepository.setOrderError(order.id, errorCode, reason, retryAt);
  if (nextStatus) await orderRepository.updateOrderStatusById(order.id, nextStatus);
}
