"use client";

import { useCallback, useMemo, useState } from "react";
import { encodeFunctionData, type Hex } from "viem";
import composableCowAbi from "@/abi/composableCoW.json";
import { deleteDraftOrder } from "@/client/api/polyswapApi";
import { useSignAction } from "@/hooks/useSignAction";
import type { SafeCall } from "@/client/safe/types";
import { COMPOSABLE_COW } from "@/shared/contracts";
import { getErrorMessage } from "@/utils/errors";

interface UseRemoveOrder {
  /**
   * Off-chain draft cancellation: signs an EIP-191 message and DELETEs the row.
   * Throws on failure.
   */
  deleteDraft: (orderId: number) => Promise<void>;

  /**
   * Build the SafeCall list for `ComposableCoW.remove(orderHash)`. The caller
   * passes this to <SafeSignModal calls={...} />. After the modal fires
   * onConfirmed, the caller records it server-side with `finalizeRemoval`;
   * the listener's order-health check catches any removal that call misses.
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
        await deleteDraftOrder(orderId, signed.signature, signed.timestamp);
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
