import { MarketsBrowseView } from "@/components/markets/MarketsBrowseView";
import { Suspense } from "react";
import { MarketsSkeleton } from "@/components/markets/MarketsSkeleton";
import { publicPageMetadata } from "@/server/seo";

export const metadata = publicPageMetadata({
  title: "Browse Polymarket questions | Polyswap",
  description:
    "Browse Polymarket questions about crypto, economics, elections and more, then choose the odds that should trigger your Polygon token swap.",
  path: "/markets",
});

export default function MarketsPage() {
  return (
    <Suspense fallback={<MarketsSkeleton />}>
      <MarketsBrowseView />
    </Suspense>
  );
}
