import { CatIllus } from "./illustrations";
import type { MarketCategory } from "@/types/design";

interface Cat {
  k: MarketCategory;
  t: string;
  d: string;
}

const CATS: Cat[] = [
  {
    k: "Economy",
    t: "Macro & rates",
    d: "Fed cuts, CPI, recession odds.",
  },
  {
    k: "Politics",
    t: "Regulation & elections",
    d: "SEC actions, ETF approvals, votes.",
  },
  {
    k: "Crypto",
    t: "Crypto catalysts",
    d: "Price targets, halvings, launches, airdrops.",
  },
  {
    k: "Geopolitics",
    t: "Geopolitics",
    d: "Wars, sanctions, energy shocks.",
  },
];

export function Categories() {
  return (
    <section className="border-b border-ink bg-paper-2">
      <div className="mx-auto max-w-[1280px] px-6 py-12 sm:px-8 lg:px-12 lg:py-20">
        <div className="mb-8 grid gap-6 lg:mb-10 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4">
            <p className="eyebrow mb-3">Built for crypto</p>
            <h2 className="display text-3xl leading-[1.05] sm:text-4xl lg:text-[44px]">
              News that
              <br />
              <span className="display-italic">moves the chart.</span>
            </h2>
          </div>
          <p className="font-serif text-base leading-snug text-ink-2 sm:text-lg lg:col-span-8 lg:max-w-[640px] lg:self-end lg:text-[19px]">
            These are the four kinds of questions that historically move crypto prices the most.
            They&rsquo;re a starting point — any market on Polymarket can drive a swap if you want
            it to.
          </p>
        </div>

        <div className="grid border border-ink bg-paper sm:grid-cols-2 lg:grid-cols-4">
          {CATS.map((c, i) => (
            <div
              key={c.k}
              className={`p-6 sm:p-7 lg:p-8 ${
                i < CATS.length - 1
                  ? "border-b border-ink lg:!border-b-0 lg:[&:not(:last-child)]:border-r sm:[&:nth-child(3)]:border-b-0 sm:[&:nth-child(4)]:border-b-0 sm:[&:nth-child(odd)]:border-r"
                  : ""
              }`}
            >
              <div className="mb-4 text-ink lg:mb-5">
                <CatIllus category={c.k} size={56} />
              </div>
              <p className="font-serif text-2xl lg:text-[26px]">{c.t}</p>
              <p className="mt-1 text-sm text-ink-3">{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
