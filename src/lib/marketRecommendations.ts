import type { DatabaseMarket } from "../backend/interfaces/Database";
import { CRYPTO_RELEVANT_CATEGORIES, type MarketCategory } from "../types/design";

export const RECOMMENDATION_POLICY = {
  oddsMin: 10,
  oddsMax: 90,
  volumeMin: 10_000,
  liquidityMin: 5_000,
  volume24hMin: 1_000,
  spreadMax: 0.05,
  horizonHours: 48,
  // Each Gamma id filter is limited to 100 IDs; enrich at most three batches.
  gammaBatchSize: 100,
  candidateLimit: 300,
  candidatesPerEvent: 10,
  pageSize: 20,
  perEventPerPage: 2,
  cacheMs: 120_000,
  timeoutMs: 5_000,
} as const;

export interface OddsRange {
  oddsMin: number;
  oddsMax: number;
}

export interface RecommendationOptions extends OddsRange {
  category: MarketCategory | null;
  limit: number;
  offset: number;
}

export interface RecommendedMarket {
  id: string;
  slug: string;
  eventSlug: string | null;
  question: string;
  category: MarketCategory;
  yesTokenId: string;
  noTokenId: string;
  yesProbability: number;
  volumeTotal: number;
  volume24h: number;
  liquidity: number;
  spread: number;
  endsAt: string;
  score: number;
}

export type DatabaseRecommendationMarket = Omit<DatabaseMarket, "end_date" | "updated_at"> & {
  end_date: string | null;
};

interface RecommendationPageMetadata {
  total: number;
  asOf: string;
  candidateCount: number;
  truncated: boolean;
}

export type RecommendationPage = RecommendationPageMetadata &
  (
    | { source: "gamma"; markets: RecommendedMarket[] }
    | {
        source: "database";
        fallbackReason: "rate_limit";
        markets: DatabaseRecommendationMarket[];
      }
  );

function isOddsRangeValid({ oddsMin, oddsMax }: OddsRange): boolean {
  return (
    Number.isInteger(oddsMin) &&
    Number.isInteger(oddsMax) &&
    oddsMin >= 5 &&
    oddsMin < oddsMax &&
    oddsMax <= 95
  );
}

export function parseRecommendationOptions(params: URLSearchParams): RecommendationOptions | null {
  if (
    ["oddsMin", "oddsMax", "limit", "offset"].some(
      (key) => params.has(key) && params.get(key)?.trim() === ""
    )
  ) {
    return null;
  }
  const oddsMin = Number(params.get("oddsMin") ?? RECOMMENDATION_POLICY.oddsMin);
  const oddsMax = Number(params.get("oddsMax") ?? RECOMMENDATION_POLICY.oddsMax);
  const limit = Number(params.get("limit") ?? RECOMMENDATION_POLICY.pageSize);
  const offset = Number(params.get("offset") ?? 0);
  const rawCategory = params.get("category");
  const category = rawCategory === null || rawCategory === "All" ? null : rawCategory;
  if (
    !isOddsRangeValid({ oddsMin, oddsMax }) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (category !== null && !CRYPTO_RELEVANT_CATEGORIES.includes(category as MarketCategory))
  ) {
    return null;
  }
  return { oddsMin, oddsMax, limit, offset, category: category as MarketCategory | null };
}
