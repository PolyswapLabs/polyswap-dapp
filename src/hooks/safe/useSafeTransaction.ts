"use client";

import { useEffect, useRef, useState } from "react";
import { parseAbiItem, type Address, type Hash } from "viem";
import { usePublicClient, useWaitForCallsStatus } from "wagmi";
import { fetchMultisigTransaction, type FetchResult } from "@/services/safe/safeTxService";
import type { SafeTxStatus } from "@/services/safe/types";

const POLL_INTERVAL_MS = 4_000;
const NOT_FOUND_GRACE_MS = 30_000; // Safe indexer lag tolerance

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
  const publicClient = usePublicClient();

  // ---- 5792 path: hand off to wagmi entirely. ----
  const { data: callsStatus } = useWaitForCallsStatus({
    id: safeTxHash,
    pollingInterval: POLL_INTERVAL_MS,
    query: { enabled: use5792 && Boolean(safeTxHash) },
  });

  useEffect(() => {
    if (!use5792 || !callsStatus) return;
    // EIP-5792 maps numeric status codes onto string buckets in viem:
    //   100         → "pending"
    //   200         → "success"
    //   300/400/500/600 → "failure"
    // The numeric code is preserved on `callsStatus.statusCode`, which we use
    // to distinguish "cancelled offchain" (400) from "confirmed but reverted"
    // (500) and "chain rules" (600). Per eip5792.xyz, 400 is reserved for
    // "batch was not included onchain and the wallet will not retry it" — not
    // for nonce-replacement, so we surface it as `error` and let the user
    // retry.
    const statusCode = (callsStatus as { statusCode?: number }).statusCode;
    switch (callsStatus.status) {
      case "pending":
        setStatus({ kind: "awaitingExecution" });
        break;
      case "success": {
        const onChainHash = callsStatus.receipts?.[0]?.transactionHash;
        if (onChainHash) setStatus({ kind: "executed", onChainHash });
        break;
      }
      case "failure": {
        const onChainHash = callsStatus.receipts?.[0]?.transactionHash;
        if (onChainHash) {
          setStatus({ kind: "reverted", onChainHash });
        } else if (statusCode === 400) {
          // Wallet (Safe) cancelled the bundle offchain. Treat as a regular
          // error so the modal offers a retry instead of misreporting nonce
          // replacement.
          setStatus({ kind: "error", error: new Error("The wallet cancelled the request.") });
        } else {
          setStatus({
            kind: "error",
            error: new Error(`Transaction failed (status ${statusCode ?? "unknown"}).`),
          });
        }
        break;
      }
    }
  }, [use5792, callsStatus]);

  // ---- Fallback path: REST poll + on-chain event watch, run concurrently. ----
  const restNotFoundSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (use5792) return;
    if (!safeTxHash || !safeAddress || !publicClient) return;

    restNotFoundSinceRef.current = null;

    const ac = new AbortController();
    let cancelled = false;
    let pollHandle: ReturnType<typeof setTimeout> | null = null;

    // Real-time happy path: ExecutionSuccess / ExecutionFailure both emit
    // an indexed bytes32 txHash that equals the safeTxHash.
    const unwatch = publicClient.watchEvent({
      address: safeAddress,
      events: [
        parseAbiItem("event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)"),
        parseAbiItem("event ExecutionFailure(bytes32 indexed txHash, uint256 payment)"),
      ],
      onLogs: (logs) => {
        if (cancelled) return;
        // Filter to logs whose txHash topic matches the target safeTxHash.
        const log = logs.find(
          (l) =>
            (l as { args?: { txHash?: string } }).args?.txHash?.toLowerCase() ===
            safeTxHash.toLowerCase()
        );
        if (!log) return;
        const success = log.eventName === "ExecutionSuccess";
        setStatus({
          kind: success ? "executed" : "reverted",
          onChainHash: log.transactionHash!,
        });
      },
    });

    const poll = async () => {
      if (cancelled) return;

      const result = await fetchMultisigTransaction(safeTxHash, ac.signal).catch(
        (e: unknown): FetchResult => ({
          kind: "error",
          error: e instanceof Error ? e : new Error(String(e)),
        })
      );

      if (cancelled) return;

      if (result.kind === "notFound") {
        // Tolerate indexer lag.
        if (restNotFoundSinceRef.current === null) {
          restNotFoundSinceRef.current = Date.now();
        }
        if (Date.now() - restNotFoundSinceRef.current > NOT_FOUND_GRACE_MS) {
          // Still not indexed after grace — likely never reached the service.
          // Stop polling — the on-chain event watcher remains active and will catch a successful
          // execution if one arrives.
          return;
        }
      } else if (result.kind === "ok") {
        restNotFoundSinceRef.current = null;
        const tx = result.tx;

        if (tx.isExecuted) {
          if (tx.transactionHash && tx.isSuccessful !== null) {
            setStatus({
              kind: tx.isSuccessful ? "executed" : "reverted",
              onChainHash: tx.transactionHash,
            });
            return; // terminal — stop polling
          }
          // isExecuted but isSuccessful still null — wait one more poll.
        } else {
          // We deliberately do NOT call `isReplaced` here. Safe-via-WC may
          // re-build the SafeTx (e.g. adjust safeTxGas / refundReceiver) before
          // execution, which changes the EIP-712 hash that Safe Transaction
          // Service indexes. Our locally-returned `safeTxHash` then differs
          // from the indexed one, and a naive nonce-equality check would flag
          // the user's own executed tx as "replaced" — exactly the false
          // positive we keep hitting.
          //
          // The `ExecutionSuccess` / `ExecutionFailure` watchEvent above is the
          // authoritative terminal source: it matches by indexed `txHash`, and
          // wagmi's polled state will catch the executed flip on the next REST
          // tick once Safe Tx Service indexes it.
          const have = (tx.confirmations ?? []).length;
          const need = tx.confirmationsRequired;
          setStatus(
            have >= need
              ? { kind: "awaitingExecution" }
              : { kind: "awaitingSignatures", have, need }
          );
        }
      }
      // result.kind === "error" → transient. Don't surface; just retry.

      pollHandle = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();

    return () => {
      cancelled = true;
      ac.abort();
      if (pollHandle) clearTimeout(pollHandle);
      unwatch();
    };
  }, [use5792, safeTxHash, safeAddress, publicClient]);

  return status;
}
