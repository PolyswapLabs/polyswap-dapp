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

export function isOddsRangeValid({ oddsMin, oddsMax }: OddsRange): boolean {
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

function numeric(raw: unknown): number | null {
  if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function stringArray(raw: unknown): string[] | null {
  try {
    const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  } catch {
    return null;
  }
}

const RELEVANCE: Readonly<Record<string, number>> = {
  crypto: 1,
  economy: 1,
  finance: 0.9,
  geopolitics: 0.8,
  politics: 0.7,
  elections: 0.7,
  tech: 0.6,
  ai: 0.6,
};

export function recommendationScore(
  market: Pick<
    RecommendedMarket,
    "volume24h" | "liquidity" | "spread" | "yesProbability" | "endsAt"
  >,
  tags: readonly string[],
  category: string,
  now: number
): number {
  const normalized = (value: number) =>
    Math.log1p(Math.min(Math.max(value, 0), 1_000_000)) / Math.log1p(1_000_000);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const activity = normalized(market.volume24h);
  const liquidityQuality =
    0.7 * normalized(market.liquidity) +
    0.3 * clamp(1 - market.spread / RECOMMENDATION_POLICY.spreadMax);
  const uncertainty = clamp(4 * market.yesProbability * (1 - market.yesProbability));
  const relevance = Math.max(
    0,
    ...[category, ...tags].map((tag) => RELEVANCE[tag.trim().toLowerCase()] ?? 0)
  );
  const daysRemaining = (Date.parse(market.endsAt) - now) / 86_400_000;
  const timing = 1 / (1 + Math.max(daysRemaining - 2, 0) / 90);
  return (
    100 *
    (0.3 * activity + 0.25 * liquidityQuality + 0.2 * uncertainty + 0.15 * relevance + 0.1 * timing)
  );
}

export type EnrichmentResult =
  | { market: RecommendedMarket; rejection?: never }
  | { market?: never; rejection: string };

/** Gamma enrichments exist only in the response/cache, never in the market table. */
export function enrichRecommendation(
  candidate: DatabaseMarket,
  raw: unknown,
  now: number
): EnrichmentResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { rejection: "missing_market" };
  const gamma = raw as Record<string, unknown>;
  if (String(gamma.id) !== candidate.id) return { rejection: "id_mismatch" };
  if (gamma.active !== true || gamma.closed !== false || gamma.acceptingOrders !== true) {
    return { rejection: "not_trading" };
  }
  const category = candidate.category as MarketCategory;
  if (!CRYPTO_RELEVANT_CATEGORIES.includes(category)) return { rejection: "category" };
  const outcomes = stringArray(gamma.outcomes);
  const tokens = stringArray(gamma.clobTokenIds);
  const prices = stringArray(gamma.outcomePrices);
  const yesIndex = outcomes?.indexOf("Yes") ?? -1;
  const noIndex = outcomes?.indexOf("No") ?? -1;
  const dbYesIndex = candidate.outcomes.indexOf("Yes");
  const dbNoIndex = candidate.outcomes.indexOf("No");
  if (
    outcomes?.length !== 2 ||
    tokens?.length !== 2 ||
    prices?.length !== 2 ||
    candidate.outcomes.length !== 2 ||
    candidate.clob_token_ids.length !== 2 ||
    yesIndex < 0 ||
    noIndex < 0 ||
    dbYesIndex < 0 ||
    dbNoIndex < 0 ||
    !tokens[yesIndex] ||
    !tokens[noIndex] ||
    tokens[yesIndex] === tokens[noIndex] ||
    tokens[yesIndex] !== candidate.clob_token_ids[dbYesIndex] ||
    tokens[noIndex] !== candidate.clob_token_ids[dbNoIndex]
  ) {
    return { rejection: "outcome_mismatch" };
  }
  const yesProbability = numeric(prices[yesIndex]);
  const noProbability = numeric(prices[noIndex]);
  if (
    yesProbability === null ||
    noProbability === null ||
    yesProbability > 1 ||
    noProbability > 1
  ) {
    return { rejection: "invalid_price" };
  }
  const volume24h = numeric(gamma.volume24hrClob) ?? numeric(gamma.volume24hr);
  const liquidity =
    numeric(gamma.liquidityClob) ?? numeric(gamma.liquidityNum) ?? numeric(gamma.liquidity);
  const spread = numeric(gamma.spread);
  if (volume24h === null || liquidity === null || spread === null) {
    return { rejection: "missing_metrics" };
  }
  if (volume24h < RECOMMENDATION_POLICY.volume24hMin) return { rejection: "activity" };
  if (liquidity < RECOMMENDATION_POLICY.liquidityMin) return { rejection: "liquidity" };
  if (spread > RECOMMENDATION_POLICY.spreadMax) return { rejection: "spread" };
  if (
    !candidate.active ||
    candidate.volume < RECOMMENDATION_POLICY.volumeMin ||
    candidate.liquidity < RECOMMENDATION_POLICY.liquidityMin
  ) {
    return { rejection: "database_eligibility" };
  }
  const endsAt = candidate.end_date?.toISOString();
  if (!endsAt || Date.parse(endsAt) <= now + RECOMMENDATION_POLICY.horizonHours * 3_600_000) {
    return { rejection: "horizon" };
  }
  const market: RecommendedMarket = {
    id: candidate.id,
    slug: candidate.slug,
    eventSlug: candidate.event_slug,
    question: candidate.question,
    category,
    yesTokenId: tokens[yesIndex] as string,
    noTokenId: tokens[noIndex] as string,
    yesProbability,
    volumeTotal: candidate.volume,
    volume24h,
    liquidity,
    spread,
    endsAt,
    score: 0,
  };
  market.score = recommendationScore(market, candidate.tags, category, now);
  return { market };
}

/** Defer siblings, preserving every eligible market and a deterministic total. */
export function diversifyRecommendations(
  markets: readonly RecommendedMarket[]
): RecommendedMarket[] {
  let remaining = [...markets].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const ordered: RecommendedMarket[] = [];
  while (remaining.length > 0) {
    const block: RecommendedMarket[] = [];
    const deferred: RecommendedMarket[] = [];
    const events = new Map<string, number>();
    for (const market of remaining) {
      const event = market.eventSlug ? `event:${market.eventSlug}` : `market:${market.id}`;
      const count = events.get(event) ?? 0;
      if (
        block.length < RECOMMENDATION_POLICY.pageSize &&
        count < RECOMMENDATION_POLICY.perEventPerPage
      ) {
        block.push(market);
        events.set(event, count + 1);
      } else {
        deferred.push(market);
      }
    }
    const fill = Math.min(RECOMMENDATION_POLICY.pageSize - block.length, deferred.length);
    block.push(...deferred.splice(0, fill));
    ordered.push(...block);
    remaining = deferred;
  }
  return ordered;
}
