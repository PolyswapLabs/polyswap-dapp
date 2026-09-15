export type MarketCategory =
  | "Politics"
  | "Elections"
  | "Geopolitics"
  | "Crypto"
  | "Sports"
  | "Soccer"
  | "Esports"
  | "Tech"
  | "AI"
  | "Culture"
  | "Finance"
  | "Economy"
  | "Weather";

export const MARKET_CATEGORIES: ReadonlyArray<MarketCategory> = [
  "Politics",
  "Elections",
  "Geopolitics",
  "Crypto",
  "Sports",
  "Soccer",
  "Esports",
  "Tech",
  "AI",
  "Culture",
  "Finance",
  "Economy",
  "Weather",
];

// Categories whose outcomes can plausibly move crypto prices: macro/regulation,
// monetary, geopolitics, big-tech catalysts, and crypto itself. Used to filter
// the default "All" view and the visible category pills.
export const CRYPTO_RELEVANT_CATEGORIES: ReadonlyArray<MarketCategory> = [
  "Crypto",
  "Politics",
  "Elections",
  "Geopolitics",
  "Economy",
  "Finance",
  "Tech",
  "AI",
];

export type SwapStatus = "waiting" | "ready" | "done" | "cancelled" | "expired";

export type Side = "YES" | "NO";

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
  volume24h: number;
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

export interface SwapViewModel {
  id: string;
  nickname: string;
  status: SwapStatus;
  market: MarketViewModel;
  side: Side;
  threshold: number;
  from: { symbol: string; amount: number };
  to: { symbol: string };
  quote: number;
  createdAt?: string;
  filledAt?: string;
  cancelledAt?: string;
}
