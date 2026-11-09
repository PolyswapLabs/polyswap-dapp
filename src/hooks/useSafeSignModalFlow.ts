"use client";

import { useEffect, useRef, useState } from "react";
import { useSafeSignFlow } from "@/hooks/safe/useSafeSignFlow";
import { getErrorMessage } from "@/lib/errorMessage";
import type { SafeCall } from "@/services/safe/types";

export interface SafeSignPrepare {
  run: () => Promise<void>;
  heading: string;
  body: string;
}

/**
 * Wraps the Safe transaction machine with the modal's optional pre-tx signing
 * step. Kept separate from useSafeSignFlow so it can wrap the on-chain
 * transaction state without changing it.
 */
export function useSafeSignModalFlow(
  prepare: SafeSignPrepare | undefined,
  calls: SafeCall[],
  open: boolean
) {
  const { state, send, reset } = useSafeSignFlow();
  const [prePhase, setPrePhase] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [prepareError, setPrepareError] = useState<string | null>(null);
  // React state is not a synchronous mutex: two clicks can observe the same
  // `prePhase` before the component renders again. Keep an imperative guard so
  // neither the off-chain signature nor the Safe transaction can be requested
  // twice.
  const actionInFlightRef = useRef(false);

  // On modal close: clean up state ONLY for terminal phases. Mid-flight closes
  // leave the persisted safeTxHash so a tab reload (or future modal open) can
  // resume tracking. The user's tx is still on its way.
  useEffect(() => {
    if (
      !open &&
      (state.phase === "success" ||
        state.phase === "reverted" ||
        state.phase === "rejected" ||
        state.phase === "error")
    ) {
      reset();
      actionInFlightRef.current = false;
      setPrePhase("idle");
      setPrepareError(null);
    }
  }, [open, state.phase, reset]);

  const startPrepare = async () => {
    if (actionInFlightRef.current) return;

    if (!prepare) {
      await startTransaction();
      return;
    }

    actionInFlightRef.current = true;
    setPrePhase("running");
    setPrepareError(null);
    try {
      await prepare.run();
      // Do not open a second wallet request while Safe is still dismissing the
      // message-signing request. A separate user action starts the transaction.
      setPrePhase("ready");
    } catch (e) {
      setPrePhase("error");
      setPrepareError(getErrorMessage(e, "Failed to sign confirmation message"));
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const startTransaction = async () => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    setPrePhase("idle");
    try {
      await send(calls);
    } finally {
      actionInFlightRef.current = false;
    }
  };

  return { state, prePhase, prepareError, startPrepare, startTransaction };
}
