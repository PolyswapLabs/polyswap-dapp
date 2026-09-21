import { MarketDetail } from "@/components/markets";
import type { Metadata } from "next";
import { DatabaseService } from "@/backend/services/databaseService";
import { PRIVATE_PAGE_ROBOTS, publicPageMetadata } from "@/lib/seo";

interface Props {
  params: Promise<{ marketId: string }>;
}

export default async function MarketDetailPage({ params }: Props) {
  const { marketId } = await params;
  return <MarketDetail identifier={marketId} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { marketId } = await params;
  if (!marketId || marketId.length > 255) {
    return { title: "Market · Polyswap", robots: PRIVATE_PAGE_ROBOTS };
  }

  try {
    const market = /^\d+$/.test(marketId)
      ? ((await DatabaseService.getMarketById(marketId)) ??
        (await DatabaseService.getMarketBySlug(marketId)))
      : ((await DatabaseService.getMarketBySlug(marketId)) ??
        (await DatabaseService.getMarketById(marketId)));

    if (!market || !market.active) {
      return { title: "Market · Polyswap", robots: PRIVATE_PAGE_ROBOTS };
    }

    return publicPageMetadata({
      title: `${market.question} | Polyswap`,
      description: `Explore ${market.question} on Polyswap and set a Polygon token swap to trigger when the Polymarket odds cross your threshold.`,
      path: `/markets/${encodeURIComponent(market.id)}`,
    });
  } catch {
    // A temporary database failure should not turn a valid market into noindex.
    return { title: "Market · Polyswap" };
  }
}
