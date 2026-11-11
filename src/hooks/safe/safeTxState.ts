import type { Hash } from "viem";
import type { SafeMultisigTxResponse, SafeTxStatus } from "@/client/safe/types";

const PENDING_TX_MAX_AGE_MS = 60 * 60 * 1000;
const SAFE_TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
/** EIP-5792: the batch was not included onchain and the wallet will not retry it. */
const CALLS_STATUS_CANCELLED_OFFCHAIN = 400;

export type SafeSignPhase =
  | { phase: "idle" }
  | { phase: "wallet" } // popup open, awaiting user signature
  | { phase: "rejected"; message: string }
  | { phase: "proposed"; safeTxHash: Hash }
  | { phase: "awaitingSignatures"; safeTxHash: Hash; have: number; need: number }
  | { phase: "awaitingExecution"; safeTxHash: Hash }
  | { phase: "success"; safeTxHash: Hash; onChainHash: Hash }
  | { phase: "reverted"; safeTxHash: Hash; onChainHash: Hash }
  | { phase: "error"; message: string };

export type SafeTxKind = "5792" | "safetx";

export type PendingSafeTx = { safeTxHash: Hash; kind: SafeTxKind; ts: number };

type CallsStatus = {
  status: "pending" | "success" | "failure" | undefined;
  statusCode?: number;
  receipts?: ReadonlyArray<{ transactionHash: Hash }>;
};

type MultisigTxProgress = Pick<
  SafeMultisigTxResponse,
  "isExecuted" | "isSuccessful" | "transactionHash" | "confirmations" | "confirmationsRequired"
>;

export function toFailurePhase(err: unknown): SafeSignPhase {
  const { code, message } = err as { code?: unknown; message?: string };
  if (code === 4001 || code === "ACTION_REJECTED") {
    return { phase: "rejected", message: "You rejected the request in Safe" };
  }
  return { phase: "error", message: message ?? "Unknown error" };
}

function parsePendingSafeTx(raw: string): PendingSafeTx | null {
  try {
    const parsed = JSON.parse(raw) as PendingSafeTx;
    const isValid =
      typeof parsed.safeTxHash === "string" &&
      SAFE_TX_HASH_PATTERN.test(parsed.safeTxHash) &&
      typeof parsed.ts === "number" &&
      (parsed.kind === "5792" || parsed.kind === "safetx");
    return isValid ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns the in-flight tx stored under `storageKey`, discarding it if it is
 * malformed, older than an hour, or was sent through another path: a capability
 * change means its id format no longer matches what useSafeTransaction expects.
 */
export function readPendingSafeTx(
  storageKey: string,
  expectedKind: SafeTxKind
): PendingSafeTx | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  const pending = parsePendingSafeTx(raw);
  if (
    pending &&
    Date.now() - pending.ts <= PENDING_TX_MAX_AGE_MS &&
    pending.kind === expectedKind
  ) {
    return pending;
  }
  localStorage.removeItem(storageKey);
  return null;
}

/**
 * viem buckets EIP-5792 codes into pending (100), success (200) and failure
 * (300-600). Returns null when there is nothing new to report yet.
 */
export function callsStatusToSafeTxStatus(callsStatus: CallsStatus): SafeTxStatus | null {
  const onChainHash = callsStatus.receipts?.[0]?.transactionHash;
  switch (callsStatus.status) {
    case "pending":
      return { kind: "awaitingExecution" };
    case "success":
      return onChainHash ? { kind: "executed", onChainHash } : null;
    case "failure":
      if (onChainHash) return { kind: "reverted", onChainHash };
      // Surfaced as a plain error so the modal offers a retry.
      if (callsStatus.statusCode === CALLS_STATUS_CANCELLED_OFFCHAIN) {
        return { kind: "error", error: new Error("The wallet cancelled the request.") };
      }
      return {
        kind: "error",
        error: new Error(`Transaction failed (status ${callsStatus.statusCode ?? "unknown"}).`),
      };
    default:
      return null;
  }
}

/**
 * Returns null while the service reports an execution whose outcome it has not
 * indexed yet.
 *
 * A pending tx is deliberately never reported as replaced: Safe-via-WC may
 * rebuild the SafeTx before execution, which changes the hash the service
 * indexes, so a nonce comparison would flag the user's own executed tx. The
 * ExecutionSuccess / ExecutionFailure watcher is the authoritative terminal
 * source.
 */
export function multisigTxToSafeTxStatus(tx: MultisigTxProgress): SafeTxStatus | null {
  if (tx.isExecuted) {
    if (!tx.transactionHash || tx.isSuccessful === null) return null;
    return { kind: tx.isSuccessful ? "executed" : "reverted", onChainHash: tx.transactionHash };
  }
  const have = (tx.confirmations ?? []).length;
  const need = tx.confirmationsRequired;
  return have >= need ? { kind: "awaitingExecution" } : { kind: "awaitingSignatures", have, need };
}

export type TrackedSafeTxStatus = { hash: Hash; status: SafeTxStatus };

const IDLE_STATUS: SafeTxStatus = { kind: "idle" };

/** A status only applies to the transaction it was observed for. */
export function statusForHash(
  tracked: TrackedSafeTxStatus | null,
  safeTxHash: Hash | undefined
): SafeTxStatus {
  return tracked && tracked.hash === safeTxHash ? tracked.status : IDLE_STATUS;
}
