import { MarketsList } from "@/components/markets";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Browse Polymarket questions | Polyswap",
  description:
    "Browse Polymarket questions about crypto, economics, elections and more, then choose the odds that should trigger your Polygon token swap.",
  path: "/markets",
});

export default function MarketsPage() {
  return <MarketsList />;
}
