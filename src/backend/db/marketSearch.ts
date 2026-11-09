import { Prisma, type Market as PrismaMarket } from "@prisma/client";
import { prisma } from "./prisma";
import { toMarketRow } from "./rowMappers";
import { createLogger } from "@/backend/logger";
import type { DatabaseMarket } from "@/backend/interfaces/Database";
import { RECOMMENDATION_POLICY } from "@/lib/marketRecommendations";
import { CRYPTO_RELEVANT_CATEGORIES, type MarketCategory } from "@/types/design";

const log = createLogger("db-market-search");

interface SearchMarketsOptions {
  q?: string;
  category?: string;
  categories?: string[];
  volumeMin?: number;
  liquidityMin?: number;
  sort?: "volume" | "liquidity" | "end_date" | "interest";
  limit?: number;
  offset?: number;
}

const INTEREST_CATEGORY_BOOSTS: Record<string, number> = {
  Economy: 1.1,
  Crypto: 1.05,
};

const INTEREST_NOISE_REGEX = [
  "how many tweets",
  "number of tweets",
  "tweet count",
  "tweets in \\d{4}",
  "tweets between",
  "tweets per",
  "posts? \\d+(-\\d+)? tweets",
  "posts? \\d+\\+? tweets",
].join("|");

function buildPrefixTsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

export const marketSearch = {
  /**
   * Tags are stored already lowercased so the suggestion lookup index can be
   * a plain B-tree (Nile blocks function calls in index expressions).
   */
  async refreshTagIndex(): Promise<number> {
    const fetchStart = Date.now();
    const rows = await prisma.market.findMany({
      where: { active: true },
      select: { tags: true },
    });
    log.debug(`tag-index: fetched ${rows.length} active markets in ${Date.now() - fetchStart}ms`);

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.tags) {
        const key = tag.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    log.debug(`tag-index: aggregated ${counts.size} unique tags`);

    return prisma.$transaction(
      async (tx) => {
        const deleted = await tx.tagIndex.deleteMany();
        log.debug(`tag-index: cleared ${deleted.count} old rows`);

        if (counts.size === 0) {
          log.warn("tag-index: no active markets had any tags");
          return 0;
        }

        const insertStart = Date.now();
        await tx.tagIndex.createMany({
          data: Array.from(counts, ([tag, marketCount]) => ({ tag, marketCount })),
        });
        log.debug(`tag-index: inserted ${counts.size} rows in ${Date.now() - insertStart}ms`);
        return counts.size;
      },
      { timeout: 60_000 }
    );
  },

  async getTagSuggestions(
    prefix: string,
    limit: number
  ): Promise<Array<{ tag: string; count: number }>> {
    if (prefix.length === 0) return [];
    const rows = await prisma.tagIndex.findMany({
      where: { tag: { startsWith: prefix.toLowerCase() } },
      orderBy: [{ marketCount: "desc" }, { tag: "asc" }],
      take: limit,
    });
    return rows.map((r) => ({ tag: r.tag, count: r.marketCount }));
  },

  async countMarkets(opts: SearchMarketsOptions): Promise<number> {
    const where = buildSearchWhere(opts);
    const rows = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM markets WHERE ${where}
    `;
    return rows[0]?.total ?? 0;
  },

  async searchMarkets(opts: SearchMarketsOptions): Promise<DatabaseMarket[]> {
    const { sort = "volume", limit = 50, offset = 0, category } = opts;
    // Search and its count share the same predicates. Editorial eligibility
    // belongs exclusively to getRecommendationCandidates.
    const where = buildSearchWhere(opts);

    const orderBy = buildOrderBy(sort, Boolean(category));

    const rows = await prisma.$queryRaw<PrismaMarket[]>`
      SELECT id, slug, event_slug AS "eventSlug", question, description, category,
             tags, outcomes, volume, liquidity, end_date AS "endDate",
             clob_token_ids AS "clobTokenIds", protocol_version AS "protocolVersion",
             position_ids AS "positionIds", condition_id AS "conditionId", active, neg_risk AS "negRisk",
             updated_at AS "updatedAt"
      FROM markets
      WHERE ${where}
      ORDER BY ${orderBy}, id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map(toMarketRow);
  },

  async getRecommendationCandidates(category: MarketCategory | null): Promise<{
    markets: DatabaseMarket[];
    truncated: boolean;
  }> {
    const where = buildSearchWhere({
      category: category ?? undefined,
      categories: category ? undefined : [...CRYPTO_RELEVANT_CATEGORIES],
      volumeMin: RECOMMENDATION_POLICY.volumeMin,
      liquidityMin: RECOMMENDATION_POLICY.liquidityMin,
    });
    const orderBy = buildOrderBy("interest", Boolean(category));
    const rows = await prisma.$queryRaw<PrismaMarket[]>`
      WITH candidates AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN event_slug IS NULL OR event_slug = ''
            THEN 'market:' || id ELSE 'event:' || event_slug END
          ORDER BY ${orderBy}, id ASC
        ) AS event_rank
        FROM markets
        WHERE ${where}
          AND end_date > NOW() + ${RECOMMENDATION_POLICY.horizonHours} * INTERVAL '1 hour'
          AND question !~* ${INTEREST_NOISE_REGEX}
          AND (outcomes = '["Yes", "No"]'::jsonb OR outcomes = '["No", "Yes"]'::jsonb)
          AND CASE protocol_version
            WHEN 'v1' THEN CARDINALITY(clob_token_ids) = 2
              AND clob_token_ids[1] ~ '^[0-9]+$' AND clob_token_ids[2] ~ '^[0-9]+$'
              AND clob_token_ids[1] <> clob_token_ids[2]
            WHEN 'v2' THEN CARDINALITY(position_ids) = 2
              AND position_ids[1] ~ '^[0-9]+$' AND position_ids[2] ~ '^[0-9]+$'
              AND position_ids[1] <> position_ids[2]
            ELSE FALSE END
      )
      SELECT id, slug, event_slug AS "eventSlug", question, description, category,
             tags, outcomes, volume, liquidity, end_date AS "endDate",
             clob_token_ids AS "clobTokenIds", protocol_version AS "protocolVersion",
             position_ids AS "positionIds", condition_id AS "conditionId", active, neg_risk AS "negRisk",
             updated_at AS "updatedAt"
      FROM candidates
      WHERE event_rank <= ${RECOMMENDATION_POLICY.candidatesPerEvent}
      ORDER BY ${orderBy}, id ASC
      LIMIT ${RECOMMENDATION_POLICY.candidateLimit + 1}
    `;
    return {
      markets: rows.slice(0, RECOMMENDATION_POLICY.candidateLimit).map(toMarketRow),
      truncated: rows.length > RECOMMENDATION_POLICY.candidateLimit,
    };
  },
};

// ============================================================
// Internal helpers for the search query
// ============================================================

function buildSearchWhere(opts: SearchMarketsOptions): Prisma.Sql {
  const { q, category, categories, volumeMin = 0, liquidityMin = 0 } = opts;

  const fragments: Prisma.Sql[] = [
    Prisma.sql`active = TRUE`,
    Prisma.sql`protocol_version IN ('v1', 'v2')`,
  ];
  // Default search includes markets with zero or unknown liquidity/activity.
  if (volumeMin > 0) fragments.push(Prisma.sql`volume >= ${volumeMin}`);
  if (liquidityMin > 0) fragments.push(Prisma.sql`liquidity >= ${liquidityMin}`);

  if (category) fragments.push(Prisma.sql`category = ${category}`);
  if (categories && categories.length > 0) {
    fragments.push(Prisma.sql`category = ANY(${categories}::text[])`);
  }

  if (q) {
    const tsq = buildPrefixTsQuery(q);
    if (tsq !== null) {
      fragments.push(Prisma.sql`search_vec @@ to_tsquery('simple', ${tsq})`);
    }
  }

  return Prisma.join(fragments, " AND ");
}

/**
 * Interest score = log-blended volume + liquidity, decayed by time-to-resolve,
 * with optional category boosts. Beats raw volume for "what's hot".
 */
function buildOrderBy(
  sort: NonNullable<SearchMarketsOptions["sort"]>,
  hasCategoryFilter: boolean
): Prisma.Sql {
  if (sort === "liquidity") return Prisma.sql`liquidity DESC`;
  if (sort === "end_date") return Prisma.sql`end_date ASC`;
  if (sort !== "interest") return Prisma.sql`volume DESC`;

  // View-count nudge: a small log-scaled bonus added to the volume/liquidity
  // blend. Coefficient 0.1 keeps this *slight* — at 10 views the bonus is
  // ~0.23, at 100 ~0.46, at 1k ~0.69 — vs. typical volume contributions in
  // the 5-15 range. Enough to break ties and lift recently-popular markets
  // a notch, never enough to overrule fundamentals.
  const interestExpr = Prisma.sql`(
    LN(GREATEST(volume, 0) + 1) * 0.6 +
    LN(GREATEST(liquidity, 0) + 1) * 0.4 +
    LN(GREATEST(view_count, 0) + 1) * 0.1
  ) / (1 + GREATEST(EXTRACT(EPOCH FROM (end_date - NOW())) / 86400.0, 1) / 30.0)`;

  if (hasCategoryFilter) return Prisma.sql`${interestExpr} DESC`;

  // Cast both the WHEN-arms and ELSE to numeric — without the cast, pg infers
  // the CASE arms as integer (matching `ELSE 1`) and rejects the bound float
  // multipliers (1.1, 1.05, ...) with `invalid input syntax for type integer`.
  const boostCases = Object.entries(INTEREST_CATEGORY_BOOSTS).map(
    ([cat, mult]) => Prisma.sql`WHEN ${cat} THEN ${mult}::numeric`
  );
  return Prisma.sql`(${interestExpr}) * (CASE category ${Prisma.join(boostCases, " ")} ELSE 1::numeric END) DESC`;
}
