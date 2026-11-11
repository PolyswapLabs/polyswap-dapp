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

export type Side = "YES" | "NO";
