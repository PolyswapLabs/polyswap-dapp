"use client";

import { Tape } from "@/components/charts/Tape";
import { ErrorAlert } from "@/components/primitives/PageBlocks";
import { formatTokenAmount, formatUsd } from "@/utils/format";
import { SideToggle } from "./SideToggle";
import { ThresholdSlider } from "./ThresholdSlider";
import { ThresholdNote } from "./ThresholdNote";
import { TokenPicker } from "./TokenPicker";
import { AdvancedOptions } from "./AdvancedOptions";
import type { CreateFormDerived, CreateFormState } from "@/hooks/useCreateOrderForm";
import { useMarketPriceHistory } from "@/hooks/markets/useMarkets";
import { useDefaultTokens } from "@/hooks/useDefaultTokens";
import type { SwapEstimates } from "@/hooks/useSwapEstimates";
import type { MarketViewModel } from "@/types/viewModels";
import type { PostOnlyBuyCheck } from "@/shared/orders/postOnly";
import { formatQuoteError } from "@/client/orders/quoteErrors";

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
  const currentPrice = postOnlyCheck.status === "unavailable" ? null : postOnlyCheck.bestAsk;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <section aria-labelledby="when-heading" className="border border-ink bg-paper p-4 sm:p-6">
        <h2 id="when-heading" className="mb-4 font-serif text-xl leading-tight sm:text-2xl">
          When should the swap fire?
        </h2>
        <div className="flex flex-col gap-5 lg:gap-6">
          <SideToggle value={state.side} onChange={(v) => set("side", v)} />
          <div className="flex flex-col gap-4">
            <ThresholdSlider
              value={state.threshold}
              onChange={(v) => set("threshold", v)}
              currentPrice={currentPrice}
              blockAtCurrentPrice={postOnlyEnabled}
              describedBy="threshold-note"
            />
            <ThresholdNote
              id="threshold-note"
              postOnlyEnabled={postOnlyEnabled}
              check={postOnlyCheck}
              side={state.side}
              threshold={state.threshold}
              onUseSuggested={(v) => set("threshold", v)}
            />
          </div>
          <div className="overflow-hidden border border-rule-soft bg-paper-2 p-1">
            <Tape
              data={sparkData}
              threshold={state.threshold}
              side={state.side}
              width={520}
              height={140}
              className="w-full"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="what-heading" className="border border-ink bg-paper p-4 sm:p-6">
        <h2 id="what-heading" className="mb-4 font-serif text-xl leading-tight sm:text-2xl">
          What do you want to swap?
        </h2>
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
              <p className="num mt-1 text-xs text-ink-3">≈ {formatUsd(estimates.amountInUsd)}</p>
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
                ? formatTokenAmount(estimates.amountOutEstimate)
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
