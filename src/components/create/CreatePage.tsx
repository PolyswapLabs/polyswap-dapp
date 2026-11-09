"use client";

import Link from "next/link";
import { useMemo, type ComponentProps } from "react";
import { Button } from "@/components/primitives/Button";
import { DetailSkeleton } from "@/components/primitives/DetailSkeleton";
import { ErrorAlert, PageMessage, BackLink } from "@/components/primitives/PageBlocks";
import { Icon } from "@/components/icons";
import { useMarket } from "@/hooks/markets/useMarkets";
import {
  useCreateOrderForm,
  describeImmediateFillSentence,
  describeTriggerSentence,
} from "@/hooks/useCreateOrderForm";
import { useSwapEstimates } from "@/hooks/useSwapEstimates";
import { useSafeAccount } from "@/hooks/safe/useSafeAccount";
import { CREATION_PAUSED_MESSAGE, useSubmitSwap } from "@/hooks/useSubmitSwap";
import { SafeSignModal } from "@/components/modals/SafeSignModal";
import { MarketSummaryCard } from "./MarketSummaryCard";
import { CreateForm } from "./CreateForm";
import { RecapPanel } from "./RecapPanel";
import { fmtUSD } from "@/lib/format";
import { useRuntimeConfig } from "@/components/providers/RuntimeConfigProvider";
import { getErrorMessage } from "@/lib/errorMessage";
import { checkPostOnlyBuy } from "@/lib/postOnlyOrder";

interface Props {
  marketId: string;
}

export function CreatePage({ marketId }: Props) {
  const { data: market, isLoading, isError, error: marketError } = useMarket(marketId);
  const { state, derived, set } = useCreateOrderForm();
  const { safeAddress, isReady: walletReady } = useSafeAccount();
  const estimates = useSwapEstimates({
    fromToken: state.fromToken,
    toToken: state.toToken,
    amountIn: state.amountIn,
    userAddress: safeAddress,
  });
  const { orderCreationDisabled, polymarketSentinelPostOnly } = useRuntimeConfig();

  const selectedBestAsk = state.side === "YES" ? market?.yesBestAsk : market?.noBestAsk;
  const postOnlyCheck = checkPostOnlyBuy(Math.round(state.threshold * 100), selectedBestAsk);
  const postOnlyBlocked = polymarketSentinelPostOnly && postOnlyCheck.status !== "rests";
  const wouldCross = polymarketSentinelPostOnly && postOnlyCheck.status === "crosses";

  const { submit, signingError, isPreparingTx, signModal } = useSubmitSwap({
    market,
    state,
    estimates,
    safeAddress,
    walletReady,
    orderCreationDisabled,
    postOnlyEnabled: polymarketSentinelPostOnly,
    postOnlyCheck,
  });

  const modalSummary = useMemo(() => {
    if (!market) return undefined;
    return (
      <span className="italic">
        {wouldCross
          ? describeImmediateFillSentence(state)
          : describeTriggerSentence(state, market.question)}
      </span>
    );
  }, [market, state, wouldCross]);

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (isError || !market) {
    return (
      <PageMessage>
        {isError
          ? `We couldn't load that market. ${getErrorMessage(marketError, "Try again in a moment.")}`
          : "We couldn't find that market."}{" "}
        <Link href="/markets" className="underline">
          Back to markets
        </Link>
        .
      </PageMessage>
    );
  }

  const review: ReviewAction = {
    disabled:
      orderCreationDisabled ||
      postOnlyBlocked ||
      !derived.isValid ||
      isPreparingTx ||
      estimates.isQuoteError,
    label: reviewButtonLabel(orderCreationDisabled, isPreparingTx),
    onClick: () => void submit(),
  };

  return (
    <div className="pb-32 lg:pb-16">
      {/* Header */}
      <div className="border-b border-ink py-6 lg:py-8">
        <BackLink href={`/markets/${market.id}`}>Back to market</BackLink>
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
            <ErrorAlert>
              <p>{orderCreationDisabled ? CREATION_PAUSED_MESSAGE : signingError}</p>
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
            </ErrorAlert>
          )}

          {/* Desktop CTA */}
          <div className="hidden lg:block">
            <ReviewButton {...review} size="lg" />
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

      <MobileActionBar amountInUsd={estimates.amountInUsd} review={review} />

      {signModal && <SafeSignModal {...signModal} summary={modalSummary} />}
    </div>
  );
}

function reviewButtonLabel(orderCreationDisabled: boolean, isPreparingTx: boolean): string {
  if (orderCreationDisabled) return "Order creation paused";
  return isPreparingTx ? "Preparing…" : "Review and sign";
}

interface ReviewAction {
  disabled: boolean;
  label: string;
  onClick: () => void;
}

function ReviewButton({
  disabled,
  label,
  onClick,
  size,
  className,
}: ReviewAction & Pick<ComponentProps<typeof Button>, "size" | "className">) {
  return (
    <Button
      variant="accent"
      size={size}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {label}
      <Icon.arrowRight size={14} aria-hidden />
    </Button>
  );
}

function MobileActionBar({ amountInUsd, review }: { amountInUsd: number; review: ReviewAction }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink bg-paper px-4 py-3 shadow-[0_-2px_0_0_var(--color-rule-soft)] lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-ink-3">Total in</p>
          <p className="num truncate text-base font-semibold">
            {amountInUsd > 0 ? fmtUSD(amountInUsd) : "—"}
          </p>
        </div>
        <ReviewButton {...review} size="md" className="shrink-0" />
      </div>
    </div>
  );
}
