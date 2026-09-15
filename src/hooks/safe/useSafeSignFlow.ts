"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSendCalls, useSendTransaction } from "wagmi";
import type { Hash } from "viem";
import { useSafeAccount } from "./useSafeAccount";
import { useSafeTransaction } from "./useSafeTransaction";
import { encodeMultiSend } from "@/services/safe/multiSendEncoder";
import type { SafeCall } from "@/services/safe/types";

const STORAGE_KEY_PREFIX = "polyswap.pendingSafeTx";

export type SafeSignPhase =
  | { phase: "idle" }
  | { phase: "wallet" } // popup open, awaiting user signature
  | { phase: "rejected"; message: string }
  | { phase: "proposed"; safeTxHash: Hash }
  | { phase: "awaitingSignatures"; safeTxHash: Hash; have: number; need: number }
  | { phase: "awaitingExecution"; safeTxHash: Hash }
  | { phase: "success"; safeTxHash: Hash; onChainHash: Hash }
  | { phase: "reverted"; safeTxHash: Hash; onChainHash: Hash }
  | { phase: "replaced"; safeTxHash: Hash }
  | { phase: "error"; message: string };

type Persisted = { safeTxHash: Hash; kind: "5792" | "safetx"; ts: number };

export function useSafeSignFlow() {
  const { safeAddress, supports5792, isReady } = useSafeAccount();
  const [state, dispatch] = useReducer((_s: SafeSignPhase, n: SafeSignPhase) => n, {
    phase: "idle",
  } as SafeSignPhase);

  // Tracks which send path was used so the persistence effect can write the
  // correct kind discriminant. A ref avoids rippling changes into SafeSignPhase.
  const sentViaRef = useRef<"5792" | "safetx" | null>(null);
  // Wallet requests must be strictly serial. This also protects callers other
  // than SafeSignModal from double clicks or concurrent send() calls.
  const sendingRef = useRef(false);

  const storageKey: string | null = safeAddress
    ? `${STORAGE_KEY_PREFIX}.${safeAddress.toLowerCase()}`
    : null;

  // ----- Send paths -----
  const { sendCallsAsync } = useSendCalls();
  const { sendTransactionAsync } = useSendTransaction();

  const send = useCallback(
    async (calls: SafeCall[]) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      try {
        if (!safeAddress) {
          dispatch({ phase: "error", message: "No Safe connected" });
          return;
        }
        dispatch({ phase: "wallet" });
        let safeTxHash: Hash;
        if (supports5792) {
          const result = await sendCallsAsync({
            calls: calls.map((c) => ({
              to: c.to,
              data: c.data,
              value: c.value,
            })),
          });
          safeTxHash = result.id as Hash;
          sentViaRef.current = "5792";
        } else if (calls.length === 1 && calls[0]) {
          // No batching needed.
          const c = calls[0];
          safeTxHash = await sendTransactionAsync({
            to: c.to,
            data: c.data,
            value: c.value,
          });
          sentViaRef.current = "safetx";
        } else {
          // Pre-EIP-5792 wallet: pack calls via MultiSendCallOnly so it's still
          // a single Safe transaction (single signature). Note: MultiSendCallOnly
          // is invoked via CALL — so this works even though Safe normally uses
          // DELEGATECALL for the standard MultiSend.
          const packed = encodeMultiSend(calls);
          safeTxHash = await sendTransactionAsync({
            to: packed.to,
            data: packed.data,
            value: packed.value,
          });
          sentViaRef.current = "safetx";
        }
        dispatch({ phase: "proposed", safeTxHash });
      } catch (e) {
        const err = e as Error & { code?: unknown };
        if (err.code === 4001 || (err as { code?: unknown }).code === "ACTION_REJECTED") {
          dispatch({ phase: "rejected", message: "You rejected the request in Safe" });
        } else {
          dispatch({ phase: "error", message: (err as Error).message ?? "Unknown error" });
        }
      } finally {
        sendingRef.current = false;
      }
    },
    [safeAddress, supports5792, sendCallsAsync, sendTransactionAsync]
  );

  const reset = useCallback(() => {
    dispatch({ phase: "idle" });
    sentViaRef.current = null;
    if (typeof window !== "undefined" && storageKey) localStorage.removeItem(storageKey);
  }, [storageKey]);

  // ----- Recover from localStorage on mount -----
  useEffect(() => {
    if (!isReady || typeof window === "undefined" || !storageKey) return;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Persisted;
      // Validate shape before trusting the stored value.
      if (
        typeof parsed.safeTxHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(parsed.safeTxHash) ||
        typeof parsed.ts !== "number" ||
        (parsed.kind !== "5792" && parsed.kind !== "safetx")
      ) {
        localStorage.removeItem(storageKey);
        return;
      }
      // Stale beyond 1h — drop.
      if (Date.now() - parsed.ts > 60 * 60 * 1000) {
        localStorage.removeItem(storageKey);
        return;
      }
      // Refuse to revive if the connector capability has changed since the tx
      // was sent — the id format won't match what useSafeTransaction expects.
      const expectedKind: Persisted["kind"] = supports5792 ? "5792" : "safetx";
      if (parsed.kind !== expectedKind) {
        localStorage.removeItem(storageKey);
        return;
      }
      sentViaRef.current = parsed.kind;
      dispatch({ phase: "proposed", safeTxHash: parsed.safeTxHash });
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [isReady, storageKey, supports5792]);

  // ----- Track the proposed tx -----
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
        dispatch({
          phase: "awaitingSignatures",
          safeTxHash,
          have: txStatus.have,
          need: txStatus.need,
        });
        break;
      case "awaitingExecution":
        dispatch({ phase: "awaitingExecution", safeTxHash });
        break;
      case "executed":
        dispatch({ phase: "success", safeTxHash, onChainHash: txStatus.onChainHash });
        break;
      case "reverted":
        dispatch({ phase: "reverted", safeTxHash, onChainHash: txStatus.onChainHash });
        break;
      case "replaced":
        dispatch({ phase: "replaced", safeTxHash });
        break;
      case "error":
        dispatch({ phase: "error", message: txStatus.error.message });
        break;
      // "idle" doesn't transition
    }
  }, [txStatus, safeTxHash]);

  // Derive the hash we want persisted. Using a derived value (not state itself)
  // prevents the localStorage write from firing on every poll-induced re-render —
  // otherwise the 1h TTL would silently slide forward every 4 seconds.
  const persistableHash: Hash | null =
    "safeTxHash" in state &&
    (state.phase === "proposed" ||
      state.phase === "awaitingSignatures" ||
      state.phase === "awaitingExecution")
      ? state.safeTxHash
      : null;

  // ----- Persist while in-flight -----
  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    if (persistableHash && sentViaRef.current) {
      const payload: Persisted = {
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
