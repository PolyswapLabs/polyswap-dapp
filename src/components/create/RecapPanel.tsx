import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/primitives/InfoTip";
import { DefinitionRow } from "@/components/primitives/PageBlocks";
import { expiryRecapLabel } from "@/client/orders/createOrder";
import { formatTokenAmount, formatUsd, formatPercent } from "@/utils/format";
import {
  describeImmediateFillSentence,
  describeTriggerSentence,
  type CreateFormState,
} from "@/hooks/useCreateOrderForm";
import type { SwapEstimates } from "@/hooks/useSwapEstimates";
import type { MarketViewModel } from "@/types/viewModels";

interface Props {
  market: MarketViewModel;
  state: CreateFormState;
  estimates: SwapEstimates;
  wouldCross: boolean;
}

export function RecapPanel({ market, state, estimates, wouldCross }: Props) {
  const sentence = wouldCross
    ? describeImmediateFillSentence(state)
    : describeTriggerSentence(state, market.question);

  const fromSymbol = state.fromToken?.symbol ?? "—";
  const toSymbol = state.toToken?.symbol ?? "—";
  const triggerVerb = wouldCross ? "fires immediately at" : "drops to";

  return (
    <div className="space-y-4">
      <section aria-label="In your words" className="border border-ink bg-paper-2 p-5">
        <p className="font-serif text-lg leading-snug italic">{sentence}</p>
      </section>

      <section aria-label="Order recap" className="border border-ink bg-paper p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <DefinitionRow
            term="Trigger"
            value={`${state.side} ${triggerVerb} ${formatPercent(state.threshold)}`}
          />
          <DefinitionRow term="You send" value={`${state.amountIn || "0"} ${fromSymbol}`} />
          <DefinitionRow
            term={
              <span className="inline-flex items-center gap-1.5">
                You receive
                <InfoTip
                  label="What does the estimate mean?"
                  body="The amount received is currently estimated based on the current price of the two tokens. The final reception price will be the best possible price thanks to CoW Swap Intent mechanism. The final amount will depend on the price of the two tokens at that time."
                />
              </span>
            }
            value={
              estimates.amountOutEstimate > 0
                ? `~${formatTokenAmount(estimates.amountOutEstimate)} ${toSymbol}`
                : `— ${toSymbol}`
            }
          />
          <DefinitionRow
            term="Notional"
            value={estimates.amountInUsd > 0 ? formatUsd(estimates.amountInUsd) : "—"}
          />
          <DefinitionRow term="Expires" value={expiryRecapLabel(state.expiry)} />
          <DefinitionRow
            term={
              <span className="inline-flex items-center gap-1.5">
                Price wiggle
                <InfoTip
                  label="What does price wiggle mean?"
                  body="Auto lets the CoW solver pick the best executable price at fill time, with no minimum floor. A percentage caps the slippage: if the live price would give you less than the estimation minus chosen wiggle %, the swap waits until the price recovers or the order expires."
                  width="md"
                />
              </span>
            }
            value={state.slippagePct === "auto" ? "Auto" : `${state.slippagePct}%`}
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
