"use client";

import { useEffect, useRef } from "react";
import { useSafeSignFlow } from "@/hooks/safe/useSafeSignFlow";
import type { SafeCall } from "@/client/safe/types";

/**
 * Wraps the Safe transaction machine with the modal's lifecycle: a guard against
 * sending twice, and a reset once a finished flow is closed.
 */
export function useSafeSignModalFlow(calls: SafeCall[], open: boolean) {
  const { state, send, reset } = useSafeSignFlow();
  // React state is not a synchronous mutex: two clicks can observe the same
  // state before the component renders again. Keep an imperative guard so the
  // Safe transaction cannot be requested twice.
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
    }
  }, [open, state.phase, reset]);

  const startTransaction = async () => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    try {
      await send(calls);
    } finally {
      actionInFlightRef.current = false;
    }
  };

  return { state, startTransaction };
}
