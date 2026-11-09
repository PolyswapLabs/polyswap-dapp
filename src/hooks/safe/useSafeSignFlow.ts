"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSendCalls, useSendTransaction } from "wagmi";
import type { Hash } from "viem";
import { useSafeAccount } from "./useSafeAccount";
import { useSafeTransaction } from "./useSafeTransaction";
import {
  readPendingSafeTx,
  toFailurePhase,
  type PendingSafeTx,
  type SafeSignPhase,
  type SafeTxKind,
} from "./safeTxState";
import { encodeMultiSend } from "@/services/safe/multiSendEncoder";
import type { SafeCall } from "@/services/safe/types";

const STORAGE_KEY_PREFIX = "polyswap.pendingSafeTx";

export function useSafeSignFlow() {
  const { safeAddress, supports5792, isReady } = useSafeAccount();
  const [state, setState] = useState<SafeSignPhase>({ phase: "idle" });

  // Tracks which send path was used so the persistence effect can write the
  // correct kind discriminant. A ref avoids rippling changes into SafeSignPhase.
  const sentViaRef = useRef<SafeTxKind | null>(null);
  // Wallet requests must be strictly serial. This also protects callers other
  // than SafeSignModal from double clicks or concurrent send() calls.
  const sendingRef = useRef(false);

  const storageKey: string | null = safeAddress
    ? `${STORAGE_KEY_PREFIX}.${safeAddress.toLowerCase()}`
    : null;

  const { sendCallsAsync } = useSendCalls();
  const { sendTransactionAsync } = useSendTransaction();

  const submitSafeCalls = useCallback(
    async (calls: SafeCall[]): Promise<{ safeTxHash: Hash; kind: SafeTxKind }> => {
      if (supports5792) {
        const { id } = await sendCallsAsync({
          calls: calls.map(({ to, data, value }) => ({ to, data, value })),
        });
        return { safeTxHash: id as Hash, kind: "5792" };
      }
      // Pre-EIP-5792 wallet: several calls are packed via MultiSendCallOnly so
      // they remain a single Safe transaction (single signature). It is invoked
      // via CALL, which is why this works even though Safe normally uses
      // DELEGATECALL for the standard MultiSend.
      const single = calls.length === 1 ? calls[0] : undefined;
      const { to, data, value } = single ?? encodeMultiSend(calls);
      const safeTxHash = await sendTransactionAsync({ to, data, value });
      return { safeTxHash, kind: "safetx" };
    },
    [supports5792, sendCallsAsync, sendTransactionAsync]
  );

  const send = useCallback(
    async (calls: SafeCall[]) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      try {
        if (!safeAddress) {
          setState({ phase: "error", message: "No Safe connected" });
          return;
        }
        setState({ phase: "wallet" });
        const { safeTxHash, kind } = await submitSafeCalls(calls);
        sentViaRef.current = kind;
        setState({ phase: "proposed", safeTxHash });
      } catch (err) {
        setState(toFailurePhase(err));
      } finally {
        sendingRef.current = false;
      }
    },
    [safeAddress, submitSafeCalls]
  );

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    sentViaRef.current = null;
    if (storageKey) localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Recover an in-flight tx on mount.
  useEffect(() => {
    if (!isReady || !storageKey) return;
    const pending = readPendingSafeTx(storageKey, supports5792 ? "5792" : "safetx");
    if (!pending) return;
    sentViaRef.current = pending.kind;
    setState({ phase: "proposed", safeTxHash: pending.safeTxHash });
  }, [isReady, storageKey, supports5792]);

  const safeTxHash = "safeTxHash" in state ? state.safeTxHash : undefined;
  const txStatus = useSafeTransaction({
    safeTxHash,
    safeAddress,
    use5792: supports5792,
  });

  // Bridge txStatus → flow phase
  useEffect(() => {
    if (!safeTxHash) return;
    switch (txStatus.kind) {
      case "awaitingSignatures":
        setState({
          phase: "awaitingSignatures",
          safeTxHash,
          have: txStatus.have,
          need: txStatus.need,
        });
        break;
      case "awaitingExecution":
        setState({ phase: "awaitingExecution", safeTxHash });
        break;
      case "executed":
        setState({ phase: "success", safeTxHash, onChainHash: txStatus.onChainHash });
        break;
      case "reverted":
        setState({ phase: "reverted", safeTxHash, onChainHash: txStatus.onChainHash });
        break;
      case "error":
        setState({ phase: "error", message: txStatus.error.message });
        break;
      // "idle" doesn't transition
    }
  }, [txStatus, safeTxHash]);

  // Derive the hash we want persisted. Using a derived value (not state itself)
  // prevents the localStorage write from firing on every poll-induced re-render —
  // otherwise the 1h TTL would silently slide forward every 4 seconds.
  const persistableHash: Hash | null =
    state.phase === "proposed" ||
    state.phase === "awaitingSignatures" ||
    state.phase === "awaitingExecution"
      ? state.safeTxHash
      : null;

  // Persist while in-flight.
  useEffect(() => {
    if (!storageKey) return;
    if (persistableHash && sentViaRef.current) {
      const payload: PendingSafeTx = {
        safeTxHash: persistableHash,
        kind: sentViaRef.current,
        ts: Date.now(),
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [persistableHash, storageKey]);

  return { state, send, reset };
}
