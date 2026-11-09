"use client";

import { useCallback, useMemo, useState } from "react";
import { encodeFunctionData, type Hex } from "viem";
import composableCowAbi from "@/abi/composableCoW.json";
import { apiService } from "@/services/api";
import { useSignAction } from "@/hooks/useSignAction";
import type { SafeCall } from "@/services/safe/types";
import { COMPOSABLE_COW } from "@/lib/contracts";
import { getErrorMessage } from "@/lib/errorMessage";

interface UseRemoveOrder {
  /**
   * Off-chain draft cancellation: signs an EIP-191 message and DELETEs the row.
   * Throws on failure.
   */
  deleteDraft: (orderId: number) => Promise<void>;

  /**
   * Build the SafeCall list for `ComposableCoW.remove(orderHash)`. The caller
   * passes this to <SafeSignModal calls={...} />. After the modal fires
   * onConfirmed, the caller MUST notify the server (`apiService.notifyRemoveOrder`)
   * to finalise server-side state (Polymarket cancel + DB update).
   */
  buildRemoveLiveCalls: (orderHash: Hex) => SafeCall[];

  pending: boolean;
  error: string | null;
}

export function useRemoveOrder(): UseRemoveOrder {
  const { signAction } = useSignAction();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteDraft = useCallback(
    async (orderId: number) => {
      setPending(true);
      setError(null);
      try {
        const signed = await signAction("cancel_draft", String(orderId));
        await apiService.deleteDraftOrder(orderId, signed.signature, signed.timestamp);
      } catch (e) {
        setError(getErrorMessage(e, "Failed to delete draft order"));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [signAction]
  );

  const buildRemoveLiveCalls = useCallback((orderHash: Hex): SafeCall[] => {
    const data = encodeFunctionData({
      abi: composableCowAbi,
      functionName: "remove",
      args: [orderHash],
    });
    return [{ to: COMPOSABLE_COW, data, value: 0n }];
  }, []);

  return useMemo(
    () => ({ deleteDraft, buildRemoveLiveCalls, pending, error }),
    [deleteDraft, buildRemoveLiveCalls, pending, error]
  );
}
