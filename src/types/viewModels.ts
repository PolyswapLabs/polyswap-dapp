import type { MarketCategory } from "@/shared/markets/categories";

export type SwapStatus = "waiting" | "ready" | "done" | "cancelled" | "expired";

export interface MarketViewModel {
  id: string;
  slug: string;
  /** Parent event slug — what Polymarket's URL needs (`/event/<slug>`). */
  eventSlug: string | null;
  /** CLOB token id for the YES side, used to fetch real price history. */
  yesTokenId: string | null;
  /** CLOB token id for the NO side. Needed when the user picked NO, to chart the right curve. */
  noTokenId: string | null;
  /** Lowest live ask for a BUY of the YES outcome. */
  yesBestAsk: number | null;
  /** Lowest live ask for a BUY of the NO outcome. */
  noBestAsk: number | null;
  category: MarketCategory;
  question: string;
  yesProbability: number;
  /** Genuine daily volume, when supplied by recommendation enrichment. */
  volume24h: number | null;
  /** Lifetime volume from the existing market index. */
  volumeTotal: number;
  endsAt: string;
}

export interface TokenViewModel {
  symbol: string;
  name: string;
  /** Polygon contract address for this token. */
  address: `0x${string}`;
  /** Token decimals (e.g. 6 for USDC, 18 for WETH). */
  decimals: number;
  /** Real token logo URL from the CoW token lists, when available. */
  logoURI?: string;
}
