import { Categories } from "@/components/landing/Categories";
import { FAQ } from "@/components/landing/FAQ";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Guarantees } from "@/components/landing/Guarantees";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Premise } from "@/components/landing/Premise";
import { PullQuote } from "@/components/landing/PullQuote";
import { Reveal } from "@/components/landing/Reveal";
import { publicPageMetadata } from "@/server/seo";

export const metadata = publicPageMetadata({
  title: "Polyswap | Polymarket-triggered token swaps on Polygon",
  description:
    "Set a token swap on Polygon to execute when Polymarket odds cross your chosen threshold. Your tokens stay in your wallet until the trigger fires.",
  path: "/",
});

export default function HomePage() {
  return (
    <main className="flex-1">
      {/* Hero plays its own mount choreography immediately. */}
      <Hero />
      {/* Downstream sections fade up the first time they enter the viewport. */}
      <Reveal>
        <Premise />
      </Reveal>
      <Reveal>
        <HowItWorks />
      </Reveal>
      <Reveal>
        <Categories />
      </Reveal>
      <Reveal>
        <Guarantees />
      </Reveal>
      <Reveal>
        <PullQuote />
      </Reveal>
      <Reveal>
        <FAQ />
      </Reveal>
      <Reveal>
        <FinalCTA />
      </Reveal>
    </main>
  );
}
