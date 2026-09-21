"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, isAddress, type Address, type Hash, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Button, DetailSkeleton } from "@/components/primitives";
import { Icon } from "@/components/icons";
import { useMarket, useRawMarket } from "@/hooks/useMarketsData";
import { useCreateOrder, describeSentence, type Slippage } from "@/hooks/useCreateOrder";
import { useSwapEstimates } from "@/hooks/useSwapEstimates";
import { useSafeAccount } from "@/hooks/safe/useSafeAccount";
import { SafeSignModal } from "@/components/modals/SafeSignModal";
import type { SafeCall } from "@/services/safe/types";
import { apiService } from "@/services/api";
import { MarketSummaryCard } from "./MarketSummaryCard";
import { CreateForm } from "./CreateForm";
import { RecapPanel } from "./RecapPanel";
import { useWalletModal } from "@/components/modals/WalletModalProvider";
import { fmtUSD } from "@/lib/format";
import { useRuntimeConfig } from "@/components/providers/RuntimeConfigProvider";
import { getErrorMessage } from "@/lib/errorMessage";
import { checkPostOnlyBuy, postOnlyCrossingMessage } from "@/lib/postOnlyOrder";
import { capturePostHogEvent } from "@/lib/posthog-client";

interface Props {
  marketId: string;
}

function toSafeCall(tx: { to: Address; data: Hex; value: string }): SafeCall {
  return {
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : 0n,
  };
}

function toWei(amount: string, decimals: number): string {
  const parsed = parseFloat(amount) || 0;
  if (parsed <= 0) return "0";
  // Use integer math to avoid floating-point drift.
  const factor = BigInt(10) ** BigInt(decimals);
  const scaled = (BigInt(Math.round(parsed * 1e6)) * factor) / BigInt(1e6);
  return scaled.toString();
}

/**
 * Convert the user's slippage preference into a `minBuyAmount` (raw uint256
 * string) sent to the backend. "Auto" or missing estimates fall back to "1"
 * (1 wei) — a non-zero floor that the contract / CoW solver treats as "any
 * non-zero fill counts". A numeric percent applies `(1 - pct/100)` to the
 * current estimated buy amount.
 */
function computeMinBuyAmount(
  slippage: Slippage,
  amountOutEstimate: number,
  buyDecimals: number
): string {
  if (slippage === "auto" || !Number.isFinite(amountOutEstimate) || amountOutEstimate <= 0) {
    return "1";
  }
  const floor = amountOutEstimate * (1 - slippage / 100);
  if (!(floor > 0)) return "1";
  // Same integer-math pattern as toWei: 6 dp of precision before scaling.
  const factor = BigInt(10) ** BigInt(buyDecimals);
  const scaled = (BigInt(Math.round(floor * 1e6)) * factor) / BigInt(1e6);
  // Guard against zero from extreme rounding on tiny estimates.
  return scaled > 0n ? scaled.toString() : "1";
}

export function CreatePage({ marketId }: Props) {
  const { data: market, isLoading, isError, error: marketError } = useMarket(marketId);
  const { data: rawMarket } = useRawMarket(marketId);
  const { state, derived, set } = useCreateOrder();
  const { safeAddress, isReady: walletReady } = useSafeAccount();
  const estimates = useSwapEstimates({
    fromToken: state.fromToken,
    toToken: state.toToken,
    amountIn: state.amountIn,
    userAddress: safeAddress,
  });
  const wallet = useWalletModal();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { orderCreationDisabled, polymarketSentinelPostOnly } = useRuntimeConfig();

  const [signOpen, setSignOpen] = useState(false);
  const [calls, setCalls] = useState<SafeCall[] | null>(null);
  const [signingError, setSigningError] = useState<string | null>(null);
  const [isPreparingTx, setIsPreparingTx] = useState(false);

  // Keep a stable ref to orderId so onConfirmed closure always sees latest value.
  const orderIdRef = useRef<number | null>(null);

  const isConnected = Boolean(safeAddress);
  const selectedBestAsk = state.side === "YES" ? market?.yesBestAsk : market?.noBestAsk;
  const postOnlyCheck = checkPostOnlyBuy(Math.round(state.threshold * 100), selectedBestAsk);
  const postOnlyBlocked = polymarketSentinelPostOnly && postOnlyCheck.status !== "rests";
  const wouldCross = polymarketSentinelPostOnly && postOnlyCheck.status === "crosses";
  const creationPausedMessage =
    "Order creation is temporarily blocked by the administrator. Existing orders are unaffected.";
  const reviewDisabled =
    orderCreationDisabled ||
    postOnlyBlocked ||
    !derived.isValid ||
    isPreparingTx ||
    estimates.isQuoteError;
  const reviewLabel = orderCreationDisabled
    ? "Order creation paused"
    : isPreparingTx
      ? "Preparing…"
      : "Review and sign";

  // A backend crossing error is tied to the previous side/threshold. Clear it
  // as soon as the user adjusts either value and let the live guard take over.
  useEffect(() => {
    setSigningError(null);
  }, [state.side, state.threshold]);

  const handleReview = async () => {
    if (orderCreationDisabled) {
      setSigningError(creationPausedMessage);
      return;
    }
    if (polymarketSentinelPostOnly && postOnlyCheck.status === "crosses") {
      setSigningError(postOnlyCrossingMessage(postOnlyCheck));
      return;
    }
    if (polymarketSentinelPostOnly && postOnlyCheck.status === "unavailable") {
      setSigningError(
        "The live Polymarket order book is unavailable. Please try again before signing."
      );
      return;
    }
    if (!isConnected || !walletReady || !safeAddress) {
      wallet.open();
      return;
    }
    if (!rawMarket) {
      setSigningError("Market data unavailable. Please refresh and try again.");
      return;
    }
    if (!publicClient) {
      setSigningError("RPC client not ready. Please refresh and try again.");
      return;
    }

    if (!state.fromToken || !state.toToken) {
      setSigningError("Pick the tokens you want to swap.");
      return;
    }
    if (estimates.isQuoteError) {
      setSigningError(
        estimates.quoteErrorType === "NoLiquidity"
          ? "No liquidity for this pair — the order would never settle. Pick a different pair."
          : `Can't sign: CoW Protocol returned ${
              estimates.quoteErrorType ?? "an error"
            }${estimates.quoteErrorMessage ? ` — ${estimates.quoteErrorMessage}` : ""}.`
      );
      return;
    }

    capturePostHogEvent("swap_review_started", {
      market_id: rawMarket.id,
      selected_outcome: state.side,
      threshold_percentage: Math.round(state.threshold * 100),
      expiry: state.expiry,
      slippage_mode: state.slippagePct === "auto" ? "auto" : "custom",
    });

    setSigningError(null);
    setIsPreparingTx(true);
    try {
      const sellAmountWei = toWei(state.amountIn, state.fromToken.decimals);

      if (!isAddress(state.fromToken.address)) {
        throw new Error(`Sell token address is not a valid address: ${state.fromToken.address}`);
      }
      if (!isAddress(state.toToken.address)) {
        throw new Error(`Buy token address is not a valid address: ${state.toToken.address}`);
      }
      const sellToken: Address = state.fromToken.address;
      const buyToken: Address = state.toToken.address;

      const minBuyAmount = computeMinBuyAmount(
        state.slippagePct,
        estimates.amountOutEstimate,
        state.toToken.decimals
      );

      // 7d/30d send an explicit deadline; "until-resolution" sends none.
      const DAY_MS = 24 * 60 * 60 * 1000;
      const deadline =
        state.expiry === "7d"
          ? new Date(Date.now() + 7 * DAY_MS).toISOString()
          : state.expiry === "30d"
            ? new Date(Date.now() + 30 * DAY_MS).toISOString()
            : undefined;

      const order = await apiService.createPolyswapOrder({
        sellToken,
        buyToken,
        sellAmount: sellAmountWei,
        minBuyAmount,
        selectedOutcome: state.side === "YES" ? "Yes" : "No",
        betPercentage: Math.round(state.threshold * 100),
        startDate: "now",
        deadline,
        marketId: rawMarket.id,
        owner: safeAddress,
      });

      orderIdRef.current = order.orderId;
      capturePostHogEvent("swap_draft_created", {
        order_id: order.orderId,
        market_id: rawMarket.id,
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

      // If the vault relayer is already approved for at least the sell amount,
      // skip the approve step and submit only the createWithContext call.
      const baseCalls: SafeCall[] =
        allowance >= BigInt(order.sellAmount)
          ? [toSafeCall(order.tx)]
          : order.batchTx.map(toSafeCall);

      // Fresh Safes ship with the default CompatibilityFallbackHandler — CoW
      // needs ExtensibleFallbackHandler to read EIP-1271 sigs. The backend
      // returns this self-call only when the swap-out is required.
      const callsList: SafeCall[] = order.fallbackSetupTx
        ? [toSafeCall(order.fallbackSetupTx), ...baseCalls]
        : baseCalls;

      setCalls(callsList);
      setSignOpen(true);
    } catch (err) {
      setSigningError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsPreparingTx(false);
    }
  };

  const onConfirmed = (_onChainHash: Hash, _safeTxHash: Hash) => {
    // The draft row already exists; the listener flips it to live once the
    // ConditionalOrderCreated event is observed. Invalidate the orders query
    // so the next refetch picks the new row up.
    // safeAddress is guaranteed truthy here — handleReview guards it before
    // opening the modal.
    queryClient.invalidateQueries({ queryKey: ["orders", safeAddress] });
    setSignOpen(false);
    const orderId = orderIdRef.current;
    if (orderId !== null) {
      capturePostHogEvent("swap_creation_confirmed", { order_id: orderId });
      router.push(`/dashboard/${orderId}`);
    }
  };

  const modalSummary = useMemo(() => {
    if (!market) return undefined;
    return <span className="italic">{describeSentence(state, market.question, wouldCross)}</span>;
  }, [market, state, wouldCross]);

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (isError || !market) {
    return (
      <div className="py-16 text-center text-sm text-ink-3">
        {isError
          ? `We couldn't load that market. ${getErrorMessage(marketError, "Try again in a moment.")}`
          : "We couldn't find that market."}{" "}
        <Link href="/markets" className="underline">
          Back to markets
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="pb-32 lg:pb-16">
      {/* Header */}
      <div className="border-b border-ink py-6 lg:py-8">
        <Link
          href={`/markets/${market.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink"
        >
          <Icon.arrowLeft size={12} aria-hidden /> Back to market
        </Link>
        <h1 className="mt-3 font-serif text-3xl leading-[1.1] sm:text-4xl lg:text-[44px]">
          Set up a <span className="italic">swap</span>.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-ink-3 lg:text-base">
          Pick when, pick what. We&rsquo;ll watch the odds for you.
        </p>
      </div>

      <div className="grid gap-6 py-6 lg:grid-cols-12 lg:gap-10 lg:py-10">
        <div className="space-y-5 lg:col-span-7 lg:space-y-6">
          <MarketSummaryCard market={market} />
          <CreateForm
            market={market}
            state={state}
            derived={derived}
            estimates={estimates}
            postOnlyEnabled={polymarketSentinelPostOnly}
            postOnlyCheck={postOnlyCheck}
            set={set}
          />

          {(orderCreationDisabled || signingError) && (
            <div role="alert" className="border border-no bg-no/10 px-3 py-2 text-xs text-no">
              <p>{orderCreationDisabled ? creationPausedMessage : signingError}</p>
              {signingError?.toLowerCase().includes("polymarket") && (
                <a
                  href="https://status.polymarket.com"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block underline underline-offset-2"
                >
                  Check Polymarket status ↗
                </a>
              )}
            </div>
          )}

          {/* Desktop CTA */}
          <div className="hidden lg:block">
            <Button
              variant="accent"
              size="lg"
              disabled={reviewDisabled}
              onClick={() => void handleReview()}
            >
              {reviewLabel}
              <Icon.arrowRight size={14} aria-hidden />
            </Button>
          </div>
        </div>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-6">
            <RecapPanel
              market={market}
              state={state}
              estimates={estimates}
              wouldCross={wouldCross}
            />
          </div>
        </aside>
      </div>

      {/* Mobile sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink bg-paper px-4 py-3 shadow-[0_-2px_0_0_var(--color-rule-soft)] lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-ink-3">Total in</p>
            <p className="num truncate text-base font-semibold">
              {estimates.amountInUsd > 0 ? fmtUSD(estimates.amountInUsd) : "—"}
            </p>
          </div>
          <Button
            variant="accent"
            size="md"
            disabled={reviewDisabled}
            onClick={() => void handleReview()}
            className="shrink-0"
          >
            {reviewLabel}
            <Icon.arrowRight size={14} aria-hidden />
          </Button>
        </div>
      </div>

      {calls && (
        <SafeSignModal
          open={signOpen}
          onClose={() => setSignOpen(false)}
          calls={calls}
          onConfirmed={onConfirmed}
          summary={modalSummary}
        />
      )}
    </div>
  );
}
