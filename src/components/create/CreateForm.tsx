"use client";

import { useEffect, useMemo } from "react";
import { Tape } from "@/components/primitives";
import { fmtTokenAmount, fmtUSD } from "@/lib/format";
import { SideToggle } from "./SideToggle";
import { ThresholdSlider } from "./ThresholdSlider";
import { TokenPicker } from "./TokenPicker";
import { AdvancedOptions } from "./AdvancedOptions";
import type { CreateFormDerived, CreateFormState } from "@/hooks/useCreateOrder";
import { useMarketPriceHistory } from "@/hooks/useMarketsData";
import { useTokens } from "@/hooks/useTokens";
import { cn } from "@/lib/cn";
import type { SwapEstimates } from "@/hooks/useSwapEstimates";
import type { MarketViewModel, TokenViewModel } from "@/types/design";
import { postOnlyCrossingMessage, type PostOnlyBuyCheck } from "@/lib/postOnlyOrder";

interface Props {
  market: MarketViewModel;
  state: CreateFormState;
  derived: CreateFormDerived;
  estimates: SwapEstimates;
  postOnlyEnabled: boolean;
  postOnlyCheck: PostOnlyBuyCheck;
  set: <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) => void;
}

const DEFAULT_FROM_SYMBOLS = ["USDC", "USDC.e", "USDT", "DAI"] as const;
const DEFAULT_TO_SYMBOLS = ["WETH", "WBTC", "WPOL"] as const;

export function CreateForm({
  market,
  state,
  derived,
  estimates,
  postOnlyEnabled,
  postOnlyCheck,
  set,
}: Props) {
  const { data: fetchedTokens = [], isLoading: tokensLoading } = useTokens();

  const tokens = useMemo<TokenViewModel[]>(() => {
    return fetchedTokens.map<TokenViewModel>((t) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address as `0x${string}`,
      decimals: t.decimals,
      logoURI: t.logoURI,
    }));
  }, [fetchedTokens]);

  useEffect(() => {
    if (tokens.length === 0) return;

    const findBy = (preferred: ReadonlyArray<string>) => {
      for (const sym of preferred) {
        const match = tokens.find((t) => t.symbol === sym);
        if (match) return match;
      }
      return undefined;
    };

    if (state.fromToken === null) {
      const pick = findBy(DEFAULT_FROM_SYMBOLS) ?? tokens[0];
      if (pick) set("fromToken", pick);
    }
    if (state.toToken === null) {
      const pick =
        findBy(DEFAULT_TO_SYMBOLS) ??
        tokens.find((t) => t.address !== state.fromToken?.address) ??
        tokens[0];
      if (pick) set("toToken", pick);
    }
  }, [tokens, state.fromToken, state.toToken, set]);

  const { data: history = [] } = useMarketPriceHistory(market.yesTokenId, 60);
  const yesSparkData = history.map((h) => h.p);
  const sparkData = state.side === "YES" ? yesSparkData : yesSparkData.map((p) => 1 - p);
  const thresholdMessage = !postOnlyEnabled
    ? "Immediate execution is enabled by the administrator. This order may fire as soon as it is confirmed."
    : postOnlyCheck.status === "crosses"
      ? postOnlyCrossingMessage(postOnlyCheck)
      : postOnlyCheck.status === "unavailable"
        ? "The live order book is unavailable, so we can't verify that this order will wait."
        : postOnlyCheck.bestAsk === null
          ? `There are no ${state.side} sell orders right now. Your ${Math.round(state.threshold * 100)}% trigger can wait on the book.`
          : `The best available ${state.side} price is ${Math.round(postOnlyCheck.bestAsk * 100)}%. Your ${Math.round(state.threshold * 100)}% trigger can wait on the book.`;
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
                className="w-full border border-ink bg-paper-2 px-3 py-3 text-2xl font-mono tabular-nums outline-none focus:bg-paper sm:text-3xl"
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
            <div className="mt-3 border border-ink bg-paper-2 px-3 py-3 text-2xl font-mono tabular-nums sm:text-3xl">
              {estimates.amountOutEstimate > 0
                ? fmtTokenAmount(estimates.amountOutEstimate)
                : derived.amountInNumber > 0 && !estimates.isQuoteError
                  ? "—"
                  : "0.00"}
            </div>
          </div>
        </div>
        {estimates.isQuoteError && derived.amountInNumber > 0 && (
          <p className="mt-4 border border-no bg-no/10 px-3 py-2 text-xs text-no">
            {formatQuoteError(estimates.quoteErrorType, estimates.quoteErrorMessage)}
          </p>
        )}
        {derived.validationMessage && (
          <p className="mt-4 border border-no bg-no/10 px-3 py-2 text-xs text-no">
            {derived.validationMessage}
          </p>
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

function formatQuoteError(errorType: string | null, message: string | null): string {
  switch (errorType) {
    case "NoLiquidity":
      return "No liquidity for this pair right now. Pick a different pair.";
    case "UnsupportedToken":
      return "CoW Protocol doesn't support one of these tokens. Pick a different pair.";
    case "SellAmountDoesNotCoverFee":
      return "The amount is too small to cover network fees. Increase it and try again.";
    case "InsufficientBalance":
      return "Your wallet doesn't hold enough of the send token for this swap.";
    case "InsufficientAllowance":
      return "Token allowance is too low. Approve the spender and retry.";
    default:
      return message ?? "Quote unavailable for this pair.";
  }
}
