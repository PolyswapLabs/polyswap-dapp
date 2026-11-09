"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ordersQueryKey, type OrderViewModel } from "@/hooks/useOrders";
import { useRemoveOrder } from "@/hooks/useRemoveOrder";
import { useSignAction, type SignedAction } from "@/hooks/useSignAction";
import { getErrorMessage } from "@/lib/errorMessage";
import { apiService } from "@/services/api";
import type { SafeCall } from "@/services/safe/types";

/** Cancels a draft off-chain, or drives the Safe flow that removes a live order. */
export function useCancelSwap(order: OrderViewModel | null) {
  const { address } = useAccount();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { deleteDraft, buildRemoveLiveCalls, pending, error } = useRemoveOrder();
  const { signAction } = useSignAction();
  const [signOpen, setSignOpen] = useState(false);
  const [calls, setCalls] = useState<SafeCall[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Pre-tx signed `notify_remove` payload, captured during the modal's
  // `prepare` step and replayed in `onConfirmed` after the on-chain remove
  // confirms. Keeps the popup open across BOTH steps and avoids re-prompting
  // the user after the tx.
  const pendingNotifySigRef = useRef<SignedAction | null>(null);

  const closeSignModal = () => {
    setSignOpen(false);
    setCalls(null);
  };

  const leaveToDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ordersQueryKey(address) });
    router.push("/dashboard");
  };

  const cancelDraft = async (numericId: number) => {
    try {
      await deleteDraft(numericId);
      leaveToDashboard();
    } catch {
      // error surfaced via hook state
    }
  };

  const cancel = async () => {
    setLocalError(null);
    if (!order) return;
    if (order.phase === "draft") {
      await cancelDraft(order.numericId);
      return;
    }
    if (order.phase === "live") {
      if (!order.orderHash) {
        setLocalError("Order hash not yet available — please retry in a moment.");
        return;
      }
      setCalls(buildRemoveLiveCalls(order.orderHash));
      setSignOpen(true);
    }
  };

  const onConfirmed = async () => {
    if (!order) return;
    const signed = pendingNotifySigRef.current;
    if (!signed) {
      // Shouldn't happen: prepare must run before send. Surface defensively.
      setLocalError("Missing confirmation signature — please retry the cancel.");
      closeSignModal();
      return;
    }
    try {
      await apiService.notifyRemoveOrder(order.numericId, signed.signature, signed.timestamp);
    } catch (e) {
      setLocalError(getErrorMessage(e, "Failed to finalise cancel"));
      closeSignModal();
      pendingNotifySigRef.current = null;
      return;
    }
    pendingNotifySigRef.current = null;
    closeSignModal();
    leaveToDashboard();
  };

  const prepareCancel = useCallback(async () => {
    if (!order) throw new Error("No order to cancel");
    pendingNotifySigRef.current = await signAction("notify_remove", String(order.numericId));
  }, [order, signAction]);

  const summary = useMemo(
    () => (order ? <>Cancel &ldquo;{order.nickname}&rdquo;</> : null),
    [order]
  );

  const modalProps = calls && {
    open: signOpen,
    onClose: () => {
      closeSignModal();
      pendingNotifySigRef.current = null;
    },
    calls,
    onConfirmed: () => void onConfirmed(),
    summary,
    prepare: {
      run: prepareCancel,
      heading: "Confirm cancel in your wallet",
      body: "Sign the off-chain message authorising this cancel. Then return here to open the on-chain remove transaction.",
    },
  };

  return { cancel, pending, error: localError ?? error, modalProps };
}
