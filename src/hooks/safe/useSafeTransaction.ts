"use client";

import { useEffect, useState } from "react";
import { parseAbiItem, type Address, type Hash } from "viem";
import { usePublicClient, useWaitForCallsStatus } from "wagmi";
import { fetchMultisigTransaction, type FetchResult } from "@/services/safe/safeTxService";
import type { SafeTxStatus } from "@/services/safe/types";
import { callsStatusToSafeTxStatus, multisigTxToSafeTxStatus } from "./safeTxState";

const POLL_INTERVAL_MS = 4_000;
const NOT_FOUND_GRACE_MS = 30_000; // Safe indexer lag tolerance

type StatusListener = (status: SafeTxStatus) => void;

type PublicClient = NonNullable<ReturnType<typeof usePublicClient>>;

function useCallsStatus(id: Hash | undefined, enabled: boolean, onStatus: StatusListener) {
  const { data: callsStatus } = useWaitForCallsStatus({
    id,
    pollingInterval: POLL_INTERVAL_MS,
    query: { enabled: enabled && Boolean(id) },
  });

  useEffect(() => {
    if (!enabled || !callsStatus) return;
    const status = callsStatusToSafeTxStatus(callsStatus);
    if (status) onStatus(status);
  }, [enabled, callsStatus, onStatus]);
}

/** ExecutionSuccess / ExecutionFailure emit an indexed txHash equal to the safeTxHash. */
function watchSafeExecution(
  publicClient: PublicClient,
  safeAddress: Address,
  safeTxHash: Hash,
  onStatus: StatusListener
) {
  return publicClient.watchEvent({
    address: safeAddress,
    events: [
      parseAbiItem("event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)"),
      parseAbiItem("event ExecutionFailure(bytes32 indexed txHash, uint256 payment)"),
    ],
    onLogs: (logs) => {
      const log = logs.find(
        (l) =>
          (l as { args?: { txHash?: string } }).args?.txHash?.toLowerCase() ===
          safeTxHash.toLowerCase()
      );
      if (!log) return;
      onStatus({
        kind: log.eventName === "ExecutionSuccess" ? "executed" : "reverted",
        onChainHash: log.transactionHash!,
      });
    },
  });
}

function toFetchFailure(e: unknown): FetchResult {
  return { kind: "error", error: e instanceof Error ? e : new Error(String(e)) };
}

function isTerminal(status: SafeTxStatus | null): boolean {
  return status?.kind === "executed" || status?.kind === "reverted";
}

/** REST poll of the Safe Transaction Service plus an on-chain event watch, run concurrently. */
function useSafeServicePolling(
  safeTxHash: Hash | undefined,
  safeAddress: Address | undefined,
  enabled: boolean,
  onStatus: StatusListener
) {
  const publicClient = usePublicClient();

  useEffect(() => {
    if (!enabled || !safeTxHash || !safeAddress || !publicClient) return;

    const abort = new AbortController();
    let cancelled = false;
    let pollHandle: ReturnType<typeof setTimeout> | null = null;
    let notFoundSince: number | null = null;

    const report: StatusListener = (status) => {
      if (!cancelled) onStatus(status);
    };
    const unwatch = watchSafeExecution(publicClient, safeAddress, safeTxHash, report);

    const poll = async () => {
      if (cancelled) return;
      const result = await fetchMultisigTransaction(safeTxHash, abort.signal).catch(toFetchFailure);
      if (cancelled) return;

      if (result.kind === "notFound") {
        notFoundSince ??= Date.now();
        // Likely never reached the service. The event watcher stays active and
        // still catches a successful execution.
        if (Date.now() - notFoundSince > NOT_FOUND_GRACE_MS) return;
      } else if (result.kind === "ok") {
        notFoundSince = null;
        const status = multisigTxToSafeTxStatus(result.tx);
        if (status) report(status);
        if (isTerminal(status)) return;
      }
      // result.kind === "error" is transient: don't surface it, just retry.

      pollHandle = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();

    return () => {
      cancelled = true;
      abort.abort();
      if (pollHandle) clearTimeout(pollHandle);
      unwatch();
    };
  }, [enabled, safeTxHash, safeAddress, publicClient, onStatus]);
}

type UseSafeTransactionArgs = {
  safeTxHash: Hash | undefined;
  safeAddress: Address | undefined;
  /** When true, prefer wagmi's useWaitForCallsStatus (EIP-5792). */
  use5792: boolean;
};

export function useSafeTransaction({
  safeTxHash,
  safeAddress,
  use5792,
}: UseSafeTransactionArgs): SafeTxStatus {
  const [status, setStatus] = useState<SafeTxStatus>({ kind: "idle" });
  useCallsStatus(safeTxHash, use5792, setStatus);
  useSafeServicePolling(safeTxHash, safeAddress, !use5792, setStatus);
  return status;
}
