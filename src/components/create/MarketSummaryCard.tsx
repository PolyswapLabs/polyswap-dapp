import Link from "next/link";
import { Dial } from "@/components/charts/Dial";
import { Tag } from "@/components/primitives/Tag";
import { CategoryIcon } from "@/components/icons";
import { formatDate } from "@/utils/format";
import type { MarketViewModel } from "@/types/viewModels";

interface Props {
  market: MarketViewModel;
}

export function MarketSummaryCard({ market }: Props) {
  return (
    <section aria-labelledby="market-summary" className="border border-ink bg-paper-2 p-4 sm:p-6">
      <p id="market-summary" className="eyebrow mb-3">
        01 · The question
      </p>
      <div className="flex items-start gap-4 sm:gap-5">
        <Dial
          current={market.yesProbability}
          threshold={1}
          side="YES"
          size={56}
          className="shrink-0"
          animate
        />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-lg leading-snug sm:text-xl">{market.question}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Tag tone="paper">
              <CategoryIcon category={market.category} size={11} />
              {market.category}
            </Tag>
            <span>Ends {formatDate(market.endsAt)}</span>
          </div>
        </div>
        <Link
          href={`/markets/${market.id}`}
          className="hidden shrink-0 self-start text-xs underline underline-offset-4 sm:inline"
        >
          Change
        </Link>
      </div>
    </section>
  );
}
