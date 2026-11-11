"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ordersQueryKey } from "@/hooks/useOrders";
import type { OrderViewModel } from "@/hooks/orders/orderMapper";
import { useRemoveOrder } from "@/hooks/useRemoveOrder";
import { finalizeRemoval } from "@/client/orders/finalizeRemoval";
import type { SafeCall } from "@/client/safe/types";

const REMOVAL_PENDING_NOTICE = "Cancelled on-chain. The swap's status updates within a minute.";

/** Cancels a draft off-chain, or drives the Safe flow that removes a live order. */
export function useCancelSwap(order: OrderViewModel | null) {
  const { address } = useAccount();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { deleteDraft, buildRemoveLiveCalls, pending, error } = useRemoveOrder();
  const [signOpen, setSignOpen] = useState(false);
  const [calls, setCalls] = useState<SafeCall[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set once remove() has executed: the cancel stays disabled so it is never sent twice.
  const [removedOnChain, setRemovedOnChain] = useState(false);

  const closeSignModal = () => {
    setSignOpen(false);
    setCalls(null);
  };

  const refreshOrders = () => queryClient.invalidateQueries({ queryKey: ordersQueryKey(address) });

  const cancelDraft = async (numericId: number) => {
    try {
      await deleteDraft(numericId);
      refreshOrders();
      router.push("/dashboard");
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
    setRemovedOnChain(true);
    const outcome = await finalizeRemoval(order.numericId);
    closeSignModal();
    refreshOrders();
    if (outcome === "canceled") {
      router.push("/dashboard");
      return;
    }
    // The listener's order-health check records the removal on its next pass.
    setNotice(REMOVAL_PENDING_NOTICE);
  };

  const summary = useMemo(
    () => (order ? <>Cancel &ldquo;{order.nickname}&rdquo;</> : null),
    [order]
  );

  const modalProps = calls && {
    open: signOpen,
    onClose: closeSignModal,
    calls,
    onConfirmed: () => void onConfirmed(),
    summary,
  };

  return {
    cancel,
    pending: pending || removedOnChain,
    error: localError ?? error,
    notice,
    modalProps,
  };
}
