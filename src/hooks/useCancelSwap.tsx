"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ordersQueryKey } from "@/hooks/useOrders";
import type { OrderViewModel } from "@/hooks/orders/orderMapper";
import { getOrderById } from "@/client/api/polyswapApi";
import { planCancel, removeOrderCalls, type CancelOutcome } from "@/client/orders/cancelSwap";
import { finalizeRemoval } from "@/client/orders/finalizeRemoval";
import type { SafeCall } from "@/client/safe/types";
import { getErrorMessage } from "@/utils/errors";

const REMOVAL_PENDING_NOTICE = "Cancelled on-chain. The swap's status updates within a minute.";
const CONFIRMING_ERROR = "This swap is still being confirmed on-chain. Try again in a few seconds.";

const FINAL_NOTICE: Partial<Record<string, string>> = {
  filled: "This swap has already been filled.",
  canceled: "This swap is already cancelled.",
  expired: "This swap has already expired.",
  errored: "This swap stopped with an error, so there is nothing to cancel.",
};

/**
 * Cancels a live swap through the Safe (`ComposableCoW.remove`). The order's
 * state is read fresh from the server first, since the page's copy can be stale.
 */
export function useCancelSwap(order: OrderViewModel | null, marketQuestion?: string) {
  const { address } = useAccount();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signOpen, setSignOpen] = useState(false);
  const [calls, setCalls] = useState<SafeCall[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set once remove() has executed: the cancel stays disabled so it is never sent twice.
  const [removedOnChain, setRemovedOnChain] = useState(false);

  const closeSignModal = () => {
    setSignOpen(false);
    setCalls(null);
  };

  const refreshOrders = () => queryClient.invalidateQueries({ queryKey: ordersQueryKey(address) });

  const applyOutcome = (outcome: CancelOutcome) => {
    switch (outcome.kind) {
      case "remove_on_chain":
        setCalls(removeOrderCalls(outcome.orderHash));
        setSignOpen(true);
        return;
      case "confirming":
        setError(CONFIRMING_ERROR);
        return;
      case "final":
        setNotice(FINAL_NOTICE[outcome.status] ?? "This swap can no longer be cancelled.");
        return;
      case "gone":
        router.push("/dashboard");
    }
  };

  const cancel = async () => {
    if (!order || pending) return;
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const outcome = planCancel(await getOrderById(order.numericId));
      // Whatever happened, show the server's current state.
      void refreshOrders();
      applyOutcome(outcome);
    } catch (err) {
      setError(`Couldn't cancel the swap. ${getErrorMessage(err, "Try again in a moment.")}`);
    } finally {
      setPending(false);
    }
  };

  const onConfirmed = async () => {
    if (!order) return;
    setRemovedOnChain(true);
    const outcome = await finalizeRemoval(order.numericId);
    closeSignModal();
    void refreshOrders();
    if (outcome === "canceled") {
      router.push("/dashboard");
      return;
    }
    // The listener's order-health check records the removal on its next pass.
    setNotice(REMOVAL_PENDING_NOTICE);
  };

  // The market question is what users recognise; the nickname is a fallback while it loads.
  const summary = useMemo(
    () =>
      order ? <>Cancel your swap on &ldquo;{marketQuestion ?? order.nickname}&rdquo;</> : null,
    [order, marketQuestion]
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
    error,
    notice,
    modalProps,
  };
}
