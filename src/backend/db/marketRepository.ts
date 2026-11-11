import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { toMarketRow } from "./rowMappers";
import { createLogger } from "@/backend/logger";
import type { MarketRow, Market } from "@/backend/interfaces/Market";
import type { StoredMarket } from "@/backend/services/marketSyncDiff";

const log = createLogger("db-markets");

/** No cursor means the first batch: Nile delivers a bound empty string as NULL, matching nothing. */
export function missingSearchVectorIdsQuery(cursor: string | null, batchSize: number): Prisma.Sql {
  const afterCursor = cursor === null ? Prisma.empty : Prisma.sql`AND id > ${cursor}`;
  return Prisma.sql`
    SELECT id FROM markets
    WHERE search_vec IS NULL ${afterCursor}
    ORDER BY id
    LIMIT ${batchSize}
  `;
}

export function resolveMarketIdentifiers(
  identifiers: string[],
  rows: MarketRow[]
): Map<string, MarketRow> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const resolved = new Map<string, MarketRow>();
  for (const identifier of identifiers) {
    const [first, second] = /^\d+$/.test(identifier) ? [byId, bySlug] : [bySlug, byId];
    const row = first.get(identifier) ?? second.get(identifier);
    if (row) resolved.set(identifier, row);
  }
  return resolved;
}

export const marketRepository = {
  async upsertMarket(market: Market): Promise<void> {
    const data = {
      slug: market.slug,
      eventSlug: market.eventSlug ?? null,
      question: market.question,
      description: market.description ?? null,
      category: market.category ?? null,
      tags: market.tags,
      outcomes: market.outcomes as Prisma.InputJsonValue,
      volume: new Prisma.Decimal(market.volume ?? 0),
      liquidity: new Prisma.Decimal(market.liquidity ?? 0),
      endDate: market.endDate ?? null,
      clobTokenIds: market.clobTokenIds,
      protocolVersion: market.protocolVersion,
      positionIds: market.positionIds,
      conditionId: market.conditionId,
      active: market.active,
      negRisk: market.negRisk,
      updatedAt: new Date(),
    } satisfies Prisma.MarketUpdateInput;

    await prisma.market.upsert({
      where: { id: market.id },
      create: { id: market.id, ...data },
      update: data,
    });
  },

  /** The stored fields market sync compares against Gamma. */
  async getMarketsForSync(ids: string[]): Promise<StoredMarket[]> {
    return prisma.market.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        slug: true,
        eventSlug: true,
        question: true,
        description: true,
        category: true,
        tags: true,
        outcomes: true,
        volume: true,
        liquidity: true,
        endDate: true,
        clobTokenIds: true,
        protocolVersion: true,
        positionIds: true,
        conditionId: true,
        active: true,
        negRisk: true,
      },
    });
  },

  /**
   * Call before writing changed search text. Clearing first means any failure
   * afterwards leaves a null vector for the next refresh to find, rather than
   * an old vector that no later sync would detect.
   */
  async invalidateSearchVectors(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.$executeRaw`UPDATE markets SET search_vec = NULL WHERE id = ANY(${ids}::text[])`;
  },

  /**
   * Recomputes `markets.search_vec` (multi-field weighted tsvector) for rows
   * where the column is NULL, one batch at a time. Raw SQL is required
   * because `searchVec Unsupported("tsvector")` is excluded from Prisma's
   * typed API, and Nile blocks both GENERATED columns and CREATE TRIGGER —
   * so the index has to be refreshed in application code after writes.
   */
  async refreshMissingSearchVectors(batchSize: number = 1000): Promise<number> {
    let refreshed = 0;
    // Walk by ID: a row that stays null must not be selected again in this run.
    let cursor: string | null = null;
    while (true) {
      const rows: { id: string }[] = await prisma.$queryRaw(
        missingSearchVectorIdsQuery(cursor, batchSize)
      );
      const last = rows.at(-1);
      if (!last) return refreshed;
      const ids = rows.map((row) => row.id);
      const result = await prisma.$executeRaw`
        UPDATE markets SET search_vec = (
          setweight(to_tsvector('english', question), 'A') ||
          setweight(to_tsvector('simple',  regexp_replace(tags::text, '[{},"]', ' ', 'g')), 'B') ||
          setweight(to_tsvector('simple',  slug), 'C') ||
          setweight(to_tsvector('english', coalesce(description, '')), 'D')
        )
        WHERE id = ANY(${ids}::text[])
      `;
      refreshed += Number(result);
      cursor = last.id;
    }
  },

  async removeEndedMarkets(): Promise<number> {
    const now = new Date();
    // Ended markets still referenced by an order are kept (the detail page
    // needs their title + event slug, and the FK is onDelete:SetNull so a
    // delete would null the order's marketId). Flag them inactive so they drop
    // out of search; getMarketById still resolves them by id.
    const deactivated = await prisma.market.updateMany({
      where: { endDate: { lt: now }, active: true, orders: { some: {} } },
      data: { active: false },
    });
    if (deactivated.count > 0) {
      log.info(`deactivated ${deactivated.count} ended markets still linked to orders`);
    }
    const { count } = await prisma.market.deleteMany({
      where: { endDate: { lt: now }, orders: { none: {} } },
    });
    return count;
  },

  async getMarketById(id: string): Promise<MarketRow | null> {
    const row = await prisma.market.findUnique({ where: { id } });
    return row ? toMarketRow(row) : null;
  },

  /**
   * Bulk variant of the single-market lookup in one query. Each identifier
   * resolves like `GET /api/markets/{slug}`: numeric strings try the id first,
   * anything else tries the slug first. Unknown identifiers are omitted.
   */
  async getMarketsByIdentifiers(identifiers: string[]): Promise<Map<string, MarketRow>> {
    if (identifiers.length === 0) return new Map();
    const rows = await prisma.market.findMany({
      where: { OR: [{ id: { in: identifiers } }, { slug: { in: identifiers } }] },
    });
    return resolveMarketIdentifiers(identifiers, rows.map(toMarketRow));
  },

  async getMarketBySlug(slug: string): Promise<MarketRow | null> {
    const row = await prisma.market.findUnique({ where: { slug } });
    return row ? toMarketRow(row) : null;
  },

  /**
   * Atomically increment `view_count` for a market. Identifier is matched
   * against the primary key first, then `slug`, mirroring `getMarketById/BySlug`.
   * Returns true if a row was updated. `updateMany` is used so an unknown
   * identifier resolves to `count: 0` instead of throwing P2025.
   */
  async incrementMarketViews(identifier: string): Promise<boolean> {
    const data = { viewCount: { increment: 1 } };
    const byId = await prisma.market.updateMany({ where: { id: identifier }, data });
    if (byId.count > 0) return true;
    const bySlug = await prisma.market.updateMany({ where: { slug: identifier }, data });
    return bySlug.count > 0;
  },
};
