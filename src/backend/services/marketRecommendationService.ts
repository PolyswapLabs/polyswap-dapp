import type { MarketRow } from "@/backend/interfaces/Market";
import type { MarketCategory } from "@/shared/markets/categories";
import {
  RECOMMENDATION_POLICY,
  type RecommendationMarketRow,
  type RecommendationOptions,
  type RecommendationPage,
  type RecommendedMarket,
} from "@/shared/markets/recommendationPolicy";
import { createLogger } from "../logger";
import { getRetryAt } from "../utils/httpRetry";
import { diversifyRecommendations, enrichRecommendation } from "./marketRecommendationScoring";
import { GAMMA_API_URL } from "@/backend/polymarket/gamma";

const log = createLogger("market-recommendations");

interface RecommendationCandidates {
  markets: MarketRow[];
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
        markets: RecommendationMarketRow[];
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

  async function fetchBatch(markets: MarketRow[]): Promise<unknown[]> {
    const url = new URL("/markets", dependencies.baseUrl ?? GAMMA_API_URL);
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
      markets: shortlist.map(({ end_date, updated_at: _internal, ...market }) => ({
        ...market,
        end_date: end_date?.toISOString() ?? null,
      })),
      asOf: new Date(timestamp).toISOString(),
      expiresAt: Math.min(gammaBlockedUntil, timestamp + RECOMMENDATION_POLICY.cacheMs),
      candidateCount: shortlist.length,
      truncated: candidates.truncated || candidates.markets.length > shortlist.length,
    };
  }

  /** Returns null when Gamma rate limited any batch; the cooldown is recorded before returning. */
  async function fetchGammaPayload(shortlist: MarketRow[]): Promise<unknown[] | null> {
    const batches: MarketRow[][] = [];
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
      return null;
    }
    if (failures.length > 0) {
      throw new RecommendationUnavailableError("Recommendations are temporarily unavailable.", {
        cause: new AggregateError(failures, "Gamma batch enrichment failed"),
      });
    }
    return payload;
  }

  function enrichShortlist(shortlist: MarketRow[], payload: unknown[], timestamp: number) {
    const byId = new Map<string, unknown>();
    for (const raw of payload) {
      if (raw && typeof raw === "object" && !Array.isArray(raw) && "id" in raw) {
        byId.set(String(raw.id), raw);
      }
    }
    const rejections: Record<string, number> = {};
    const markets: RecommendedMarket[] = [];
    for (const candidate of shortlist) {
      const result = enrichRecommendation(candidate, byId.get(candidate.id), timestamp);
      if (result.market) markets.push(result.market);
      else rejections[result.rejection] = (rejections[result.rejection] ?? 0) + 1;
    }
    return { markets, rejections };
  }

  async function buildSnapshot(category: MarketCategory | null): Promise<Snapshot> {
    const startedAt = now();
    const candidates = await dependencies.loadCandidates(category);
    if (gammaBlockedUntil > now()) return databaseSnapshot(candidates);
    const shortlist = candidates.markets.slice(0, RECOMMENDATION_POLICY.candidateLimit);
    const payload = await fetchGammaPayload(shortlist);
    if (!payload) {
      log.warn("Gamma rate limited; using database markets", {
        category: category ?? "All",
        candidates: shortlist.length,
        retryAt: new Date(gammaBlockedUntil).toISOString(),
      });
      return databaseSnapshot(candidates);
    }
    const timestamp = now();
    const { markets, rejections } = enrichShortlist(shortlist, payload, timestamp);
    log.info("snapshot built", {
      category: category ?? "All",
      candidates: shortlist.length,
      gammaRequests: Math.ceil(shortlist.length / RECOMMENDATION_POLICY.gammaBatchSize),
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
