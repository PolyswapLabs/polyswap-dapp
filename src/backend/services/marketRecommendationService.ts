import type { DatabaseMarket } from "../interfaces/Database";
import type { MarketCategory } from "../../types/design";
import {
  diversifyRecommendations,
  enrichRecommendation,
  RECOMMENDATION_POLICY,
  type DatabaseRecommendationMarket,
  type RecommendationOptions,
  type RecommendationPage,
  type RecommendedMarket,
} from "../../lib/marketRecommendations";
import { createLogger } from "../logger";
import { getRetryAt } from "../utils/httpRetry";

const log = createLogger("market-recommendations");

export interface RecommendationCandidates {
  markets: DatabaseMarket[];
  truncated: boolean;
}

interface Dependencies {
  loadCandidates: (category: MarketCategory | null) => Promise<RecommendationCandidates>;
  fetch?: typeof fetch;
  now?: () => number;
  baseUrl?: string;
}

interface SnapshotMetadata {
  asOf: string;
  expiresAt: number;
  candidateCount: number;
  truncated: boolean;
}

type Snapshot = SnapshotMetadata &
  (
    | { source: "gamma"; markets: RecommendedMarket[] }
    | {
        source: "database";
        fallbackReason: "rate_limit";
        markets: DatabaseRecommendationMarket[];
      }
  );

class GammaRateLimitError extends Error {
  constructor(readonly retryUntil: number) {
    super("Gamma returned HTTP 429");
  }
}

export class RecommendationUnavailableError extends Error {}

/** Process-local, read-only enrichment. No persistent storage or refresh job. */
export function createMarketRecommendationService(dependencies: Dependencies) {
  const cache = new Map<string, Snapshot>();
  const inFlight = new Map<string, Promise<Snapshot>>();
  const now = dependencies.now ?? Date.now;
  const fetchGamma = dependencies.fetch ?? fetch;
  // Gamma's cooldown spans categories so changing filters cannot hammer the API.
  let gammaBlockedUntil = 0;

  async function fetchBatch(markets: DatabaseMarket[]): Promise<unknown[]> {
    const url = new URL(
      "/markets",
      dependencies.baseUrl ?? process.env.POLYMARKET_API_URL ?? "https://gamma-api.polymarket.com"
    );
    for (const market of markets) url.searchParams.append("id", market.id);
    url.searchParams.set("limit", String(RECOMMENDATION_POLICY.gammaBatchSize));
    url.searchParams.append("version", "v1");
    url.searchParams.append("version", "v2");
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    // No redirects or retries: one HTTP attempt per 100-market batch.
    const response = await fetchGamma(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(RECOMMENDATION_POLICY.timeoutMs),
    });
    if (response.status === 429) {
      const timestamp = now();
      throw new GammaRateLimitError(
        getRetryAt(response.headers.get("retry-after"), timestamp, RECOMMENDATION_POLICY.cacheMs)
      );
    }
    if (!response.ok) {
      const details = (await response.text()).slice(0, 1_000);
      throw new Error(`Gamma returned HTTP ${response.status}${details ? `: ${details}` : ""}`);
    }
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new Error("Invalid Gamma response");
    return raw;
  }

  function databaseSnapshot(candidates: RecommendationCandidates): Snapshot {
    const timestamp = now();
    const shortlist = candidates.markets.slice(0, RECOMMENDATION_POLICY.candidateLimit);
    return {
      source: "database",
      fallbackReason: "rate_limit",
      markets: shortlist.map((market) => ({
        id: market.id,
        slug: market.slug,
        event_slug: market.event_slug,
        question: market.question,
        description: market.description,
        category: market.category,
        tags: market.tags,
        outcomes: market.outcomes,
        volume: market.volume,
        liquidity: market.liquidity,
        end_date: market.end_date?.toISOString() ?? null,
        clob_token_ids: market.clob_token_ids,
        protocol_version: market.protocol_version,
        position_ids: market.position_ids,
        condition_id: market.condition_id,
        active: market.active,
        neg_risk: market.neg_risk,
      })),
      asOf: new Date(timestamp).toISOString(),
      expiresAt: Math.min(gammaBlockedUntil, timestamp + RECOMMENDATION_POLICY.cacheMs),
      candidateCount: shortlist.length,
      truncated: candidates.truncated || candidates.markets.length > shortlist.length,
    };
  }

  async function buildSnapshot(category: MarketCategory | null): Promise<Snapshot> {
    const startedAt = now();
    const candidates = await dependencies.loadCandidates(category);
    if (gammaBlockedUntil > now()) return databaseSnapshot(candidates);
    const shortlist = candidates.markets.slice(0, RECOMMENDATION_POLICY.candidateLimit);
    const batches: DatabaseMarket[][] = [];
    for (
      let offset = 0;
      offset < shortlist.length;
      offset += RECOMMENDATION_POLICY.gammaBatchSize
    ) {
      batches.push(shortlist.slice(offset, offset + RECOMMENDATION_POLICY.gammaBatchSize));
    }
    // Fetch up to three independent batches concurrently; inspect all outcomes.
    const results = await Promise.allSettled(batches.map(fetchBatch));
    const payload: unknown[] = [];
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") payload.push(...result.value);
      else failures.push(result.reason);
    }
    const rateLimits = failures.filter(
      (failure): failure is GammaRateLimitError => failure instanceof GammaRateLimitError
    );
    if (rateLimits.length > 0) {
      gammaBlockedUntil = Math.max(
        gammaBlockedUntil,
        ...rateLimits.map((error) => error.retryUntil)
      );
      log.warn("Gamma rate limited; using database markets", {
        category: category ?? "All",
        candidates: shortlist.length,
        retryAt: new Date(gammaBlockedUntil).toISOString(),
      });
      return databaseSnapshot(candidates);
    }
    if (failures.length > 0) {
      throw new RecommendationUnavailableError("Recommendations are temporarily unavailable.", {
        cause: new AggregateError(failures, "Gamma batch enrichment failed"),
      });
    }
    const byId = new Map<string, unknown>();
    for (const raw of payload) {
      if (raw && typeof raw === "object" && !Array.isArray(raw) && "id" in raw) {
        byId.set(String(raw.id), raw);
      }
    }
    const timestamp = now();
    const rejections: Record<string, number> = {};
    const markets: RecommendedMarket[] = [];
    for (const candidate of shortlist) {
      const result = enrichRecommendation(candidate, byId.get(candidate.id), timestamp);
      if (result.market) markets.push(result.market);
      else rejections[result.rejection] = (rejections[result.rejection] ?? 0) + 1;
    }
    log.info("snapshot built", {
      category: category ?? "All",
      candidates: shortlist.length,
      gammaRequests: batches.length,
      eligible: markets.length,
      rejections,
      durationMs: timestamp - startedAt,
    });
    return {
      source: "gamma",
      markets,
      asOf: new Date(timestamp).toISOString(),
      expiresAt: timestamp + RECOMMENDATION_POLICY.cacheMs,
      candidateCount: shortlist.length,
      truncated: candidates.truncated || candidates.markets.length > shortlist.length,
    };
  }

  async function snapshot(category: MarketCategory | null): Promise<Snapshot> {
    const key = category ?? "All";
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      log.debug("cache hit", { category: key });
      return cached;
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = buildSnapshot(category)
      .then((value) => {
        cache.set(key, value);
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  }

  return {
    async getPage(options: RecommendationOptions): Promise<RecommendationPage> {
      const data = await snapshot(options.category);
      const currentTime = now();
      const metadata = {
        asOf: data.asOf,
        candidateCount: data.candidateCount,
        truncated: data.truncated,
      };
      if (data.source === "database") {
        // Retain the database's interest ordering and base eligibility. Odds and
        // daily metrics are unavailable in the DB; the client loads CLOB prices.
        const markets = data.markets.filter(
          (market) =>
            market.active &&
            market.volume >= RECOMMENDATION_POLICY.volumeMin &&
            market.liquidity >= RECOMMENDATION_POLICY.liquidityMin &&
            (!options.category || market.category === options.category) &&
            market.end_date !== null &&
            Date.parse(market.end_date) >
              currentTime + RECOMMENDATION_POLICY.horizonHours * 3_600_000
        );
        return {
          ...metadata,
          source: "database",
          fallbackReason: data.fallbackReason,
          markets: markets.slice(options.offset, options.offset + options.limit),
          total: markets.length,
        };
      }
      const eligible = data.markets.filter(
        (market) =>
          market.yesProbability >= options.oddsMin / 100 &&
          market.yesProbability <= options.oddsMax / 100 &&
          Date.parse(market.endsAt) > currentTime + RECOMMENDATION_POLICY.horizonHours * 3_600_000
      );
      const ordered = diversifyRecommendations(eligible);
      return {
        ...metadata,
        source: "gamma",
        markets: ordered.slice(options.offset, options.offset + options.limit),
        total: ordered.length,
      };
    },
  };
}
