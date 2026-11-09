"use client";

import { Tape } from "@/components/charts/Tape";
import { ErrorAlert } from "@/components/primitives";
import { fmtTokenAmount, fmtUSD } from "@/lib/format";
import { SideToggle } from "./SideToggle";
import { ThresholdSlider } from "./ThresholdSlider";
import { TokenPicker } from "./TokenPicker";
import { AdvancedOptions } from "./AdvancedOptions";
import type { CreateFormDerived, CreateFormState } from "@/hooks/useCreateOrderForm";
import { useMarketPriceHistory } from "@/hooks/markets/useMarkets";
import { useDefaultTokens } from "@/hooks/useDefaultTokens";
import { cn } from "@/lib/cn";
import type { SwapEstimates } from "@/hooks/useSwapEstimates";
import type { MarketViewModel } from "@/types/design";
import { describePostOnlyStatus, type PostOnlyBuyCheck } from "@/lib/postOnlyOrder";
import { formatQuoteError } from "@/lib/quoteErrors";

interface Props {
  market: MarketViewModel;
  state: CreateFormState;
  derived: CreateFormDerived;
  estimates: SwapEstimates;
  postOnlyEnabled: boolean;
  postOnlyCheck: PostOnlyBuyCheck;
  set: <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) => void;
}

export function CreateForm({
  market,
  state,
  derived,
  estimates,
  postOnlyEnabled,
  postOnlyCheck,
  set,
}: Props) {
  const { tokens, isLoading: tokensLoading } = useDefaultTokens(state, set);

  const { data: history = [] } = useMarketPriceHistory(market.yesTokenId, 60);
  const yesSparkData = history.map((h) => h.p);
  const sparkData = state.side === "YES" ? yesSparkData : yesSparkData.map((p) => 1 - p);
  const thresholdMessage = describePostOnlyStatus(
    postOnlyEnabled,
    postOnlyCheck,
    state.side,
    state.threshold
  );
  const thresholdBlocked = postOnlyEnabled && postOnlyCheck.status !== "rests";

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {/* 02 — When */}
      <section className="border border-ink bg-paper p-4 sm:p-6">
        <p className="eyebrow mb-4">02 · When should it fire</p>
        <div className="flex flex-col gap-5 lg:gap-6">
          <SideToggle value={state.side} onChange={(v) => set("side", v)} />
          <ThresholdSlider value={state.threshold} onChange={(v) => set("threshold", v)} />
          <div className="overflow-hidden border border-rule-soft bg-paper-2 p-3">
            <Tape
              data={sparkData}
              threshold={state.threshold}
              side={state.side}
              width={520}
              height={80}
              className="w-full"
            />
            <p className={cn("mt-2 text-xs", thresholdBlocked ? "text-no" : "text-ink-3")}>
              {thresholdMessage}
            </p>
          </div>
        </div>
      </section>

      {/* 03 — What */}
      <section className="border border-ink bg-paper p-4 sm:p-6">
        <p className="eyebrow mb-4">03 · What should we swap</p>
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
          <div>
            <p className="mb-2 text-xs text-ink-3">You send</p>
            {state.fromToken ? (
              <TokenPicker
                value={state.fromToken}
                options={tokens}
                onChange={(t) => set("fromToken", t)}
                showBalances
                title="Select token to send"
              />
            ) : (
              <TokenPickerSkeleton loading={tokensLoading} />
            )}
            <label className="mt-3 block">
              <span className="sr-only">Amount</span>
              <input
                inputMode="decimal"
                type="text"
                value={state.amountIn}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  set("amountIn", v);
                }}
                placeholder="0.00"
                className="w-full border border-ink bg-paper-2 px-3 py-3 font-mono text-2xl tabular-nums outline-none focus:bg-paper sm:text-3xl"
              />
            </label>
            {estimates.amountInUsd > 0 && (
              <p className="num mt-1 text-xs text-ink-3">≈ {fmtUSD(estimates.amountInUsd)}</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs text-ink-3">You receive (estimate)</p>
            {state.toToken ? (
              <TokenPicker
                value={state.toToken}
                options={tokens}
                onChange={(t) => set("toToken", t)}
                title="Select token to receive"
              />
            ) : (
              <TokenPickerSkeleton loading={tokensLoading} />
            )}
            <div className="mt-3 border border-ink bg-paper-2 px-3 py-3 font-mono text-2xl tabular-nums sm:text-3xl">
              {estimates.amountOutEstimate > 0
                ? fmtTokenAmount(estimates.amountOutEstimate)
                : derived.amountInNumber > 0 && !estimates.isQuoteError
                  ? "—"
                  : "0.00"}
            </div>
          </div>
        </div>
        {estimates.isQuoteError && derived.amountInNumber > 0 && (
          <ErrorAlert className="mt-4">
            {formatQuoteError(estimates.quoteErrorType, estimates.quoteErrorMessage)}
          </ErrorAlert>
        )}
        {derived.validationMessage && (
          <ErrorAlert className="mt-4">{derived.validationMessage}</ErrorAlert>
        )}
      </section>

      <AdvancedOptions state={state} onChange={(k, v) => set(k, v)} />
    </div>
  );
}

function TokenPickerSkeleton({ loading }: { loading: boolean }) {
  return (
    <div className="flex w-full items-center justify-between gap-3 border border-ink bg-paper-2 px-3 py-2.5 text-sm text-ink-3">
      {loading ? "Loading tokens…" : "No tokens available"}
    </div>
  );
}
