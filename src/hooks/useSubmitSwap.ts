"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { erc20Abi, isAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletModal } from "@/components/modals/WalletModalProvider";
import type { CreateFormState } from "@/hooks/useCreateOrderForm";
import { ordersQueryKey } from "@/hooks/useOrders";
import type { SwapEstimates } from "@/hooks/useSwapEstimates";
import {
  buildSafeCalls,
  computeMinBuyAmount,
  deadlineFromExpiry,
  toWei,
} from "@/client/orders/createOrder";
import { getErrorMessage } from "@/utils/errors";
import { postOnlyCrossingMessage, type PostOnlyBuyCheck } from "@/shared/orders/postOnly";
import { capturePostHogEvent } from "@/client/analytics";
import { formatQuoteError } from "@/client/orders/quoteErrors";
import { createPolyswapOrder } from "@/client/api/polyswapApi";
import type { SafeCall } from "@/client/safe/types";
import type { MarketViewModel } from "@/types/viewModels";

export const CREATION_PAUSED_MESSAGE =
  "Order creation is temporarily blocked by the administrator. Existing orders are unaffected.";

interface SubmitSwapParams {
  market: MarketViewModel | null | undefined;
  state: CreateFormState;
  estimates: SwapEstimates;
  safeAddress: Address | undefined;
  walletReady: boolean;
  orderCreationDisabled: boolean;
  postOnlyEnabled: boolean;
  postOnlyCheck: PostOnlyBuyCheck;
}

function requireAddress(address: string, role: "Sell" | "Buy"): Address {
  if (!isAddress(address)) {
    throw new Error(`${role} token address is not a valid address: ${address}`);
  }
  return address;
}

/** Validates the create form, creates the draft order and opens the Safe flow. */
export function useSubmitSwap({
  market,
  state,
  estimates,
  safeAddress,
  walletReady,
  orderCreationDisabled,
  postOnlyEnabled,
  postOnlyCheck,
}: SubmitSwapParams) {
  const wallet = useWalletModal();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [signOpen, setSignOpen] = useState(false);
  const [calls, setCalls] = useState<SafeCall[] | null>(null);
  const [signingError, setSigningError] = useState<string | null>(null);
  const [isPreparingTx, setIsPreparingTx] = useState(false);
  const orderIdRef = useRef<number | null>(null);

  // A backend crossing error is tied to the previous side/threshold. Clear it
  // as soon as the user adjusts either value and let the live guard take over.
  useEffect(() => {
    setSigningError(null);
  }, [state.side, state.threshold]);

  /** Blockers that hold whoever is signing, so they come before the wallet prompt. */
  const findCreationBlocker = (): string | null => {
    if (orderCreationDisabled) return CREATION_PAUSED_MESSAGE;
    if (postOnlyEnabled && postOnlyCheck.status === "crosses") {
      return postOnlyCrossingMessage(postOnlyCheck);
    }
    if (postOnlyEnabled && postOnlyCheck.status === "unavailable") {
      return "The live Polymarket order book is unavailable. Please try again before signing.";
    }
    return null;
  };

  const validateReview = (): string | null => {
    if (!market) return "Market data unavailable. Please refresh and try again.";
    if (!publicClient) return "RPC client not ready. Please refresh and try again.";
    if (!state.fromToken || !state.toToken) return "Pick the tokens you want to swap.";
    if (estimates.isQuoteError) {
      return formatQuoteError(estimates.quoteErrorType, estimates.quoteErrorMessage);
    }
    return null;
  };

  const submit = async () => {
    const blocker = findCreationBlocker();
    if (blocker) {
      setSigningError(blocker);
      return;
    }
    if (!safeAddress || !walletReady) {
      wallet.open();
      return;
    }
    const invalid = validateReview();
    if (invalid) {
      setSigningError(invalid);
      return;
    }
    // validateReview rejected these already; this only narrows their types.
    const { fromToken, toToken } = state;
    if (!market || !publicClient || !fromToken || !toToken) return;

    capturePostHogEvent("swap_review_started", {
      market_id: market.id,
      selected_outcome: state.side,
      threshold_percentage: Math.round(state.threshold * 100),
      expiry: state.expiry,
      slippage_mode: state.slippagePct === "auto" ? "auto" : "custom",
    });

    setSigningError(null);
    setIsPreparingTx(true);
    try {
      const order = await createPolyswapOrder({
        sellToken: requireAddress(fromToken.address, "Sell"),
        buyToken: requireAddress(toToken.address, "Buy"),
        sellAmount: toWei(state.amountIn, fromToken.decimals),
        minBuyAmount: computeMinBuyAmount(
          state.slippagePct,
          estimates.amountOutEstimate,
          toToken.decimals
        ),
        selectedOutcome: state.side === "YES" ? "Yes" : "No",
        betPercentage: Math.round(state.threshold * 100),
        startDate: "now",
        deadline: deadlineFromExpiry(state.expiry),
        marketId: market.id,
        owner: safeAddress,
      });

      orderIdRef.current = order.orderId;
      capturePostHogEvent("swap_draft_created", {
        order_id: order.orderId,
        market_id: market.id,
        selected_outcome: state.side,
        threshold_percentage: Math.round(state.threshold * 100),
        expiry: state.expiry,
      });

      const allowance = await publicClient.readContract({
        address: order.sellToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [safeAddress, order.vaultRelayer],
      });

      setCalls(buildSafeCalls(order, allowance));
      setSignOpen(true);
    } catch (err) {
      setSigningError(getErrorMessage(err, "Something went wrong."));
    } finally {
      setIsPreparingTx(false);
    }
  };

  const onConfirmed = () => {
    // The draft row already exists; the listener flips it to live once the
    // ConditionalOrderCreated event is observed. Invalidate the orders query
    // so the next refetch picks the new row up.
    queryClient.invalidateQueries({ queryKey: ordersQueryKey(safeAddress) });
    setSignOpen(false);
    const orderId = orderIdRef.current;
    if (orderId !== null) {
      capturePostHogEvent("swap_creation_confirmed", { order_id: orderId });
      router.push(`/dashboard/${orderId}`);
    }
  };

  const signModal = calls && {
    open: signOpen,
    onClose: () => setSignOpen(false),
    calls,
    onConfirmed,
  };

  return { submit, signingError, isPreparingTx, signModal };
}
