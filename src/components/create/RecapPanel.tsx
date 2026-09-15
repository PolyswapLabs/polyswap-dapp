import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/primitives";
import { fmtTokenAmount, fmtUSD } from "@/lib/format";
import { describeSentence, type CreateFormState } from "@/hooks/useCreateOrder";
import type { SwapEstimates } from "@/hooks/useSwapEstimates";
import type { MarketViewModel } from "@/types/design";

interface Props {
  market: MarketViewModel;
  state: CreateFormState;
  estimates: SwapEstimates;
  wouldCross: boolean;
}

export function RecapPanel({ market, state, estimates, wouldCross }: Props) {
  const sentence = describeSentence(state, market.question, wouldCross);
  const expiryLabel =
    state.expiry === "7d"
      ? "in 7 days"
      : state.expiry === "30d"
        ? "in 30 days"
        : "when the market resolves";

  const fromSymbol = state.fromToken?.symbol ?? "—";
  const toSymbol = state.toToken?.symbol ?? "—";
  const triggerVerb = wouldCross ? "fires immediately at" : "drops to";

  return (
    <div className="space-y-4">
      <section aria-label="In your words" className="border border-ink bg-paper-2 p-5">
        <p className="eyebrow mb-3">In your words</p>
        <p className="font-serif text-lg italic leading-snug">{sentence}</p>
      </section>

      <section aria-label="Order recap" className="border border-ink bg-paper p-5">
        <p className="eyebrow mb-3">Recap</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <Row
            k="Trigger"
            v={`${state.side} ${triggerVerb} ${Math.round(state.threshold * 100)}%`}
          />
          <Row k="You send" v={`${state.amountIn || "0"} ${fromSymbol}`} />
          <Row
            k={
              <span className="inline-flex items-center gap-1.5">
                You receive
                <InfoTip
                  label="What does the estimate mean?"
                  body="The amount received is currently estimated based on the current price of the two tokens. The final reception price will be the best possible price thanks to CoW Swap Intent mechanism. The final amount will depend on the price of the two tokens at that time."
                />
              </span>
            }
            v={
              estimates.amountOutEstimate > 0
                ? `~${fmtTokenAmount(estimates.amountOutEstimate)} ${toSymbol}`
                : `— ${toSymbol}`
            }
          />
          <Row k="Notional" v={estimates.amountInUsd > 0 ? fmtUSD(estimates.amountInUsd) : "—"} />
          <Row k="Expires" v={expiryLabel} />
          <Row
            k={
              <span className="inline-flex items-center gap-1.5">
                Price wiggle
                <InfoTip
                  label="What does price wiggle mean?"
                  body="Auto lets the CoW solver pick the best executable price at fill time, with no minimum floor. A percentage caps the slippage: if the live price would give you less than the estimation minus choosen wiggle %, the swap waits until the price recovers or the order expires."
                  width="md"
                />
              </span>
            }
            v={state.slippagePct === "auto" ? "Auto" : `${state.slippagePct}%`}
          />
        </dl>
      </section>

      <section aria-label="Trust" className="space-y-2 border border-ink bg-paper p-5 text-sm">
        <p className="flex items-start gap-3">
          <Icon.lock size={14} className="mt-0.5 text-accent" aria-hidden />
          Money stays in your wallet until the trigger fires.
        </p>
        <p className="flex items-start gap-3">
          <Icon.shield size={14} className="mt-0.5 text-accent" aria-hidden />
          Cancel any time. No fee on cancel or expiry.
        </p>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: string }) {
  return (
    <>
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right font-mono tabular-nums">{v}</dd>
    </>
  );
}
