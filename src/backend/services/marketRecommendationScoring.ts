import {
  getTradingAssetIds,
  parseProtocolVersion,
  parseStringArray,
} from "../../lib/polymarket/protocol";
import { RECOMMENDATION_POLICY, type RecommendedMarket } from "../../lib/marketRecommendations";
import { CRYPTO_RELEVANT_CATEGORIES, type MarketCategory } from "../../types/design";
import type { DatabaseMarket } from "../interfaces/Database";

function numeric(raw: unknown): number | null {
  if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
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

function recommendationScore(
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

type EnrichmentResult =
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
  const outcomes = parseStringArray(gamma.outcomes);
  let tokens: string[];
  let candidateTokens: string[];
  try {
    const version = parseProtocolVersion(gamma.version);
    if (version !== candidate.protocol_version) return { rejection: "protocol_mismatch" };
    tokens = getTradingAssetIds({
      protocolVersion: version,
      outcomes: gamma.outcomes,
      clobTokenIds: gamma.clobTokenIds,
      positionIds: gamma.positionIds,
    });
    candidateTokens = getTradingAssetIds({
      protocolVersion: candidate.protocol_version,
      outcomes: candidate.outcomes,
      clobTokenIds: candidate.clob_token_ids,
      positionIds: candidate.position_ids,
    });
  } catch {
    return { rejection: "invalid_assets" };
  }
  const prices = parseStringArray(gamma.outcomePrices);
  const yesIndex = outcomes.indexOf("Yes");
  const noIndex = outcomes.indexOf("No");
  const dbYesIndex = candidate.outcomes.indexOf("Yes");
  const dbNoIndex = candidate.outcomes.indexOf("No");
  if (
    outcomes.length !== 2 ||
    tokens?.length !== 2 ||
    prices.length !== 2 ||
    candidate.outcomes.length !== 2 ||
    candidateTokens.length !== 2 ||
    yesIndex < 0 ||
    noIndex < 0 ||
    dbYesIndex < 0 ||
    dbNoIndex < 0 ||
    !tokens[yesIndex] ||
    !tokens[noIndex] ||
    tokens[yesIndex] === tokens[noIndex] ||
    tokens[yesIndex] !== candidateTokens[dbYesIndex] ||
    tokens[noIndex] !== candidateTokens[dbNoIndex]
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
