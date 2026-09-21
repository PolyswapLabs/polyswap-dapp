import { Footer } from "@/components/layout/Footer";
import {
  Categories,
  FAQ,
  FinalCTA,
  Guarantees,
  Hero,
  HowItWorks,
  LandingHeader,
  Premise,
  PullQuote,
} from "@/components/landing";
import { Reveal } from "@/components/primitives";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Polyswap | Polymarket-triggered token swaps on Polygon",
  description:
    "Set a token swap on Polygon to execute when Polymarket odds cross your chosen threshold. Your tokens stay in your wallet until the trigger fires.",
  path: "/",
});

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingHeader />
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
      <Footer />
    </div>
  );
}
