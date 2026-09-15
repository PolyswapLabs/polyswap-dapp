import {
  Prisma,
  type Market as PrismaMarket,
  type PolymarketSentinel as PrismaPolymarketSentinel,
  type PolyswapOrder as PrismaPolyswapOrder,
  type SoldPosition as PrismaSoldPosition,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { createLogger } from "../logger";

const log = createLogger("db-service");
import { type Market } from "../interfaces/Market";
import { type DatabaseMarket } from "../interfaces/Database";
import {
  type PolyswapOrderData,
  type PolyswapOrderRecord,
  type DatabasePolyswapOrder,
  type DatabasePolymarketSentinel,
  type SoldPosition,
  type SoldPositionInput,
} from "../interfaces/PolyswapOrder";

export interface SearchMarketsOptions {
  q?: string;
  category?: string;
  categories?: string[];
  volumeMin?: number;
  liquidityMin?: number;
  sort?: "volume" | "liquidity" | "end_date" | "interest";
  limit?: number;
  offset?: number;
}

const INTEREST_MIN_VOLUME = 10_000;

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

type OrderStatus = "draft" | "live" | "filled" | "canceled" | "errored" | "expired";

type CowOrderStatus = NonNullable<DatabasePolyswapOrder["cow_order_status"]>;

function buildPrefixTsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function toMarketRow(m: PrismaMarket): DatabaseMarket {
  return {
    id: m.id,
    slug: m.slug,
    event_slug: m.eventSlug,
    question: m.question,
    description: m.description,
    category: m.category,
    tags: m.tags,
    outcomes: Array.isArray(m.outcomes) ? (m.outcomes as string[]) : [],
    volume: decimalToNumber(m.volume),
    liquidity: decimalToNumber(m.liquidity),
    end_date: m.endDate,
    clob_token_ids: m.clobTokenIds,
    active: m.active ?? true,
    neg_risk: m.negRisk,
    updated_at: m.updatedAt ?? undefined,
  };
}

function toPolyswapOrderRow(o: PrismaPolyswapOrder): DatabasePolyswapOrder {
  return {
    id: o.id,
    order_hash: o.orderHash,
    owner: o.owner,
    handler: o.handler ?? "",
    sell_token: o.sellToken,
    buy_token: o.buyToken,
    sell_amount: o.sellAmount.toString(),
    min_buy_amount: o.minBuyAmount.toString(),
    start_time: o.startTime,
    end_time: o.endTime,
    polymarket_order_hash: o.polymarketOrderHash ?? "",
    app_data: o.appData ?? "",
    block_number: Number(o.blockNumber ?? 0),
    transaction_hash: o.transactionHash ?? "",
    log_index: o.logIndex ?? 0,
    market_id: o.marketId,
    outcome_selected: o.outcomeSelected,
    bet_percentage: o.betPercentage === null ? null : decimalToNumber(o.betPercentage),
    status: o.status as OrderStatus,
    order_uid: o.orderUid,
    salt: o.salt,
    explicit_deadline: o.explicitDeadline,
    polymarket_maker_amount:
      o.polymarketMakerAmount === null ? null : o.polymarketMakerAmount.toString(),
    sentinel_id: o.sentinelId,
    last_error_name: o.lastErrorName,
    last_error_reason: o.lastErrorReason,
    last_error_retry_at: o.lastErrorRetryAt === null ? null : o.lastErrorRetryAt.toString(),
    last_checked_at: o.lastCheckedAt,
    cow_order_status: (o.cowOrderStatus as CowOrderStatus | null) ?? null,
    filled_at: o.filledAt ?? null,
    gate_opened_at: o.gateOpenedAt ?? null,
    actual_sell_amount: o.actualSellAmount === null ? null : o.actualSellAmount.toString(),
    actual_buy_amount: o.actualBuyAmount === null ? null : o.actualBuyAmount.toString(),
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

function toPolymarketSentinelRow(s: PrismaPolymarketSentinel): DatabasePolymarketSentinel {
  return {
    id: s.id,
    market_id: s.marketId,
    token_id: s.tokenId,
    outcome_selected: s.outcomeSelected,
    price_cents: s.priceCents,
    neg_risk: s.negRisk,
    post_only: s.postOnly,
    epoch: s.epoch,
    polymarket_order_hash: s.polymarketOrderHash,
    polymarket_maker_amount: s.polymarketMakerAmount.toString(),
    signed_order: s.signedOrder,
    expiration: s.expiration,
    status: s.status as DatabasePolymarketSentinel["status"],
    activation_tx_hash: s.activationTxHash,
    last_error: s.lastError,
    activated_at: s.activatedAt,
    filled_at: s.filledAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

function toSoldPositionRow(s: PrismaSoldPosition): SoldPosition {
  return {
    id: s.id,
    asset_id: s.assetId,
    condition_id: s.conditionId,
    size: decimalToNumber(s.size),
    sell_price: decimalToNumber(s.sellPrice),
    current_price: decimalToNumber(s.currentPrice),
    order_id: s.orderId,
    market_title: s.marketTitle ?? "",
    outcome: s.outcome ?? "",
    sold_at: s.soldAt,
  };
}

export class DatabaseService {
  static async upsertMarket(market: Market): Promise<void> {
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
      active: market.active,
      negRisk: market.negRisk,
      updatedAt: new Date(),
    } satisfies Prisma.MarketUpdateInput;

    await prisma.market.upsert({
      where: { id: market.id },
      create: { id: market.id, ...data },
      update: data,
    });
  }

  /**
   * Recomputes `markets.search_vec` (multi-field weighted tsvector) for rows
   * touched in the last hour or where the column is NULL. Raw SQL is required
   * because `searchVec Unsupported("tsvector")` is excluded from Prisma's
   * typed API, and Nile blocks both GENERATED columns and CREATE TRIGGER —
   * so the index has to be refreshed in application code after writes.
   */
  static async refreshStaleSearchVectors(): Promise<number> {
    const result = await prisma.$executeRaw`
      UPDATE markets SET search_vec = (
        setweight(to_tsvector('english', question), 'A') ||
        setweight(to_tsvector('simple',  regexp_replace(tags::text, '[{},"]', ' ', 'g')), 'B') ||
        setweight(to_tsvector('simple',  slug), 'C') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'D')
      )
      WHERE search_vec IS NULL OR updated_at >= NOW() - INTERVAL '1 hour'
    `;
    return Number(result);
  }

  /**
   * Tags are stored already lowercased so the suggestion lookup index can be
   * a plain B-tree (Nile blocks function calls in index expressions).
   */
  static async refreshTagIndex(): Promise<number> {
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
  }

  static async getTagSuggestions(
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
  }

  static async removeEndedMarkets(): Promise<number> {
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
  }

  static async countMarkets(opts: SearchMarketsOptions): Promise<number> {
    const where = this.buildSearchWhere(opts);
    const rows = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM markets WHERE ${where}
    `;
    return rows[0]?.total ?? 0;
  }

  static async getMarketCountsByCategory(categories: string[]): Promise<Record<string, number>> {
    if (categories.length === 0) return {};
    const rows = await prisma.market.groupBy({
      by: ["category"],
      where: { active: true, category: { in: categories } },
      _count: { _all: true },
    });
    const out: Record<string, number> = Object.fromEntries(categories.map((c) => [c, 0]));
    for (const r of rows) {
      if (r.category) out[r.category] = r._count._all;
    }
    return out;
  }

  static async searchMarkets(opts: SearchMarketsOptions): Promise<DatabaseMarket[]> {
    const { sort = "volume", limit = 50, offset = 0, category, q } = opts;

    const filters: Prisma.Sql[] = [this.buildSearchWhere(opts)];
    if (sort === "interest") {
      if (!category) {
        filters.push(Prisma.sql`end_date > NOW() + INTERVAL '48 hours'`);
        filters.push(Prisma.sql`volume >= ${INTEREST_MIN_VOLUME}`);
      }
      if (!q) {
        filters.push(Prisma.sql`question !~* ${INTEREST_NOISE_REGEX}`);
      }
    }
    const where = Prisma.join(filters, " AND ");

    const orderBy = this.buildOrderBy(sort, Boolean(category));

    const rows = await prisma.$queryRaw<PrismaMarket[]>`
      SELECT id, slug, event_slug AS "eventSlug", question, description, category,
             tags, outcomes, volume, liquidity, end_date AS "endDate",
             clob_token_ids AS "clobTokenIds", active, neg_risk AS "negRisk",
             updated_at AS "updatedAt"
      FROM markets
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map(toMarketRow);
  }

  static async getMarketById(id: string): Promise<DatabaseMarket | null> {
    const row = await prisma.market.findUnique({ where: { id } });
    return row ? toMarketRow(row) : null;
  }

  static async getMarketBySlug(slug: string): Promise<DatabaseMarket | null> {
    const row = await prisma.market.findUnique({ where: { slug } });
    return row ? toMarketRow(row) : null;
  }

  /**
   * Atomically increment `view_count` for a market. Identifier is matched
   * against the primary key first, then `slug`, mirroring `getMarketById/BySlug`.
   * Returns true if a row was updated. `updateMany` is used so an unknown
   * identifier resolves to `count: 0` instead of throwing P2025.
   */
  static async incrementMarketViews(identifier: string): Promise<boolean> {
    const data = { viewCount: { increment: 1 } };
    const byId = await prisma.market.updateMany({ where: { id: identifier }, data });
    if (byId.count > 0) return true;
    const bySlug = await prisma.market.updateMany({ where: { slug: identifier }, data });
    return bySlug.count > 0;
  }

  // ============================================================
  // Shared Polymarket sentinels
  // ============================================================

  static async findReusableSentinel(input: {
    marketId: string;
    tokenId: string;
    priceCents: number;
    postOnly: boolean;
    minimumExpiration: Date;
  }): Promise<DatabasePolymarketSentinel | null> {
    const row = await prisma.polymarketSentinel.findFirst({
      where: {
        marketId: input.marketId,
        tokenId: input.tokenId,
        priceCents: input.priceCents,
        postOnly: input.postOnly,
        status: { in: ["prepared", "activating", "live"] },
        expiration: { gte: input.minimumExpiration },
      },
      orderBy: { epoch: "desc" },
    });
    return row ? toPolymarketSentinelRow(row) : null;
  }

  static async getNextSentinelEpoch(input: {
    marketId: string;
    tokenId: string;
    priceCents: number;
  }): Promise<number> {
    const latest = await prisma.polymarketSentinel.findFirst({
      where: {
        marketId: input.marketId,
        tokenId: input.tokenId,
        priceCents: input.priceCents,
      },
      orderBy: { epoch: "desc" },
      select: { epoch: true },
    });
    return (latest?.epoch ?? 0) + 1;
  }

  static async createPreparedSentinel(input: {
    marketId: string;
    tokenId: string;
    outcomeSelected: string;
    priceCents: number;
    negRisk: boolean;
    postOnly: boolean;
    epoch: number;
    polymarketOrderHash: string;
    polymarketMakerAmount: string;
    signedOrder: unknown;
    expiration: Date;
  }): Promise<DatabasePolymarketSentinel> {
    const row = await prisma.polymarketSentinel.create({
      data: {
        marketId: input.marketId,
        tokenId: input.tokenId,
        outcomeSelected: input.outcomeSelected,
        priceCents: input.priceCents,
        negRisk: input.negRisk,
        postOnly: input.postOnly,
        epoch: input.epoch,
        polymarketOrderHash: input.polymarketOrderHash,
        polymarketMakerAmount: new Prisma.Decimal(input.polymarketMakerAmount),
        signedOrder: input.signedOrder as Prisma.InputJsonValue,
        expiration: input.expiration,
        status: "prepared",
      },
    });
    return toPolymarketSentinelRow(row);
  }

  static async getSentinelById(id: number): Promise<DatabasePolymarketSentinel | null> {
    const row = await prisma.polymarketSentinel.findUnique({ where: { id } });
    return row ? toPolymarketSentinelRow(row) : null;
  }

  /** Only one listener invocation may submit a shared sentinel. */
  static async claimSentinelActivation(id: number, transactionHash: string): Promise<boolean> {
    const staleActivation = new Date(Date.now() - 5 * 60 * 1000);
    const result = await prisma.polymarketSentinel.updateMany({
      where: {
        id,
        OR: [{ status: "prepared" }, { status: "activating", updatedAt: { lt: staleActivation } }],
      },
      data: {
        status: "activating",
        activationTxHash: transactionHash,
        lastError: null,
        updatedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  static async markSentinelLive(id: number): Promise<void> {
    await prisma.polymarketSentinel.update({
      where: { id },
      data: {
        status: "live",
        activatedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    });
  }

  static async releaseSentinelActivation(id: number, error: string): Promise<void> {
    await prisma.polymarketSentinel.updateMany({
      where: { id, status: "activating" },
      data: { status: "prepared", lastError: error, updatedAt: new Date() },
    });
  }

  static async markSentinelFailed(id: number, error: string): Promise<void> {
    await prisma.polymarketSentinel.update({
      where: { id },
      data: { status: "failed", lastError: error, updatedAt: new Date() },
    });
  }

  static async markSentinelFilledForOrder(orderId: number): Promise<void> {
    const order = await prisma.polyswapOrder.findUnique({
      where: { id: orderId },
      select: { sentinelId: true },
    });
    if (!order?.sentinelId) return;
    await this.markSentinelFilled(order.sentinelId);
  }

  static async markSentinelFilled(id: number): Promise<void> {
    await prisma.polymarketSentinel.updateMany({
      where: { id, status: { in: ["activating", "live"] } },
      data: { status: "filled", filledAt: new Date(), updatedAt: new Date() },
    });
  }

  // ============================================================
  // PolySwap Orders
  // ============================================================

  static async insertPolyswapOrderFromForm(orderData: {
    orderHash: string;
    handler: string;
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    minBuyAmount: string;
    startDate: string;
    deadline: string;
    marketId: string;
    owner: string;
    outcomeSelected: string;
    betPercentageValue: number;
    polymarketOrderHash: string;
    appData: string;
    salt: string;
    explicitDeadline: boolean;
    polymarketMakerAmount: string;
    sentinelId: number;
  }): Promise<number> {
    const created = await prisma.polyswapOrder.create({
      data: {
        owner: orderData.owner.toLowerCase(),
        orderHash: orderData.orderHash,
        handler: orderData.handler.toLowerCase(),
        sellToken: orderData.sellToken.toLowerCase(),
        buyToken: orderData.buyToken.toLowerCase(),
        sellAmount: new Prisma.Decimal(orderData.sellAmount),
        minBuyAmount: new Prisma.Decimal(orderData.minBuyAmount),
        startTime: new Date(orderData.startDate),
        endTime: new Date(orderData.deadline),
        marketId: orderData.marketId,
        outcomeSelected: orderData.outcomeSelected,
        betPercentage: new Prisma.Decimal(orderData.betPercentageValue),
        polymarketOrderHash: orderData.polymarketOrderHash,
        appData: orderData.appData,
        salt: orderData.salt,
        explicitDeadline: orderData.explicitDeadline,
        polymarketMakerAmount: new Prisma.Decimal(orderData.polymarketMakerAmount),
        sentinelId: orderData.sentinelId,
        status: "draft",
      },
      select: { id: true },
    });
    return created.id;
  }

  static async insertPolyswapOrder(order: PolyswapOrderRecord): Promise<number> {
    const blockNumber = Number(order.blockNumber);
    const logIndex = Number(order.logIndex);
    if (!Number.isFinite(blockNumber) || !Number.isFinite(logIndex)) {
      throw new Error(`Invalid numeric values: blockNumber=${blockNumber}, logIndex=${logIndex}`);
    }

    const data: Prisma.PolyswapOrderUncheckedCreateInput = {
      orderHash: order.orderHash,
      owner: order.owner.toLowerCase(),
      handler: order.handler.toLowerCase(),
      sellToken: order.sellToken.toLowerCase(),
      buyToken: order.buyToken.toLowerCase(),
      sellAmount: new Prisma.Decimal(order.sellAmount),
      minBuyAmount: new Prisma.Decimal(order.minBuyAmount),
      startTime: new Date(order.startTime * 1000),
      endTime: new Date(order.endTime * 1000),
      polymarketOrderHash: order.polymarketOrderHash,
      appData: order.appData,
      blockNumber: BigInt(blockNumber),
      transactionHash: order.transactionHash,
      logIndex,
      salt: order.salt ?? null,
      polymarketMakerAmount: order.polymarketMakerAmount
        ? new Prisma.Decimal(order.polymarketMakerAmount)
        : null,
      status: "live",
    };

    const saved = await prisma.polyswapOrder.upsert({
      where: { orderHash: order.orderHash },
      create: data,
      update: {
        owner: data.owner,
        handler: data.handler,
        sellToken: data.sellToken,
        buyToken: data.buyToken,
        sellAmount: data.sellAmount,
        minBuyAmount: data.minBuyAmount,
        startTime: data.startTime,
        endTime: data.endTime,
        polymarketOrderHash: data.polymarketOrderHash,
        appData: data.appData,
        blockNumber: data.blockNumber,
        transactionHash: data.transactionHash,
        logIndex: data.logIndex,
        salt: data.salt,
        polymarketMakerAmount: data.polymarketMakerAmount,
        status: data.status,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    return saved.id;
  }

  /**
   * - If a draft row exists for (polymarket_order_hash, owner) → upgrade to live
   *   and stamp the on-chain coordinates. Standard frontend-then-listener path.
   * - Otherwise → fresh live insert. Catch-up path when the draft was lost.
   */
  static async upsertLiveOrderFromEvent(input: {
    owner: string;
    orderHash: string;
    handler: string;
    salt: string;
    data: PolyswapOrderData;
    blockNumber: number;
    transactionHash: string;
    logIndex: number;
  }): Promise<{ orderId: number; sentinelId: number | null; serverCreated: boolean }> {
    const ownerLc = input.owner.toLowerCase();
    const draft = await prisma.polyswapOrder.findFirst({
      where: {
        orderHash: input.orderHash,
        owner: ownerLc,
        status: "draft",
      },
      select: { id: true, sentinelId: true },
    });

    if (draft) {
      await prisma.polyswapOrder.update({
        where: { id: draft.id },
        data: {
          status: "live",
          orderHash: input.orderHash,
          handler: input.handler.toLowerCase(),
          transactionHash: input.transactionHash,
          blockNumber: BigInt(input.blockNumber),
          logIndex: input.logIndex,
          appData: input.data.appData,
          salt: input.salt,
          // V2 staticInput carries makerAmount; keep the row consistent with what was committed on-chain.
          ...(input.data.polymarketMakerAmount
            ? { polymarketMakerAmount: new Prisma.Decimal(input.data.polymarketMakerAmount) }
            : {}),
          updatedAt: new Date(),
        },
      });
      return { orderId: draft.id, sentinelId: draft.sentinelId, serverCreated: true };
    }

    const orderId = await this.insertPolyswapOrder({
      orderHash: input.orderHash,
      owner: ownerLc,
      handler: input.handler.toLowerCase(),
      sellToken: input.data.sellToken,
      buyToken: input.data.buyToken,
      sellAmount: input.data.sellAmount,
      minBuyAmount: input.data.minBuyAmount,
      startTime: parseInt(input.data.t0, 10),
      endTime: parseInt(input.data.t, 10),
      polymarketOrderHash: input.data.polymarketOrderHash,
      appData: input.data.appData,
      blockNumber: input.blockNumber,
      transactionHash: input.transactionHash,
      logIndex: input.logIndex,
      createdAt: new Date(),
      salt: input.salt,
      polymarketMakerAmount: input.data.polymarketMakerAmount || null,
    });
    return { orderId, sentinelId: null, serverCreated: false };
  }

  static async getPolyswapOrdersByOwner(
    ownerAddress: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<DatabasePolyswapOrder[]> {
    const where = ownerAddress.trim() ? { owner: ownerAddress.toLowerCase() } : undefined;
    const rows = await prisma.polyswapOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map(toPolyswapOrderRow);
  }

  static async getPolyswapOrderByHash(orderHash: string): Promise<DatabasePolyswapOrder | null> {
    const row = await prisma.polyswapOrder.findUnique({ where: { orderHash } });
    return row ? toPolyswapOrderRow(row) : null;
  }

  static async getPolyswapOrderById(id: number): Promise<DatabasePolyswapOrder | null> {
    const row = await prisma.polyswapOrder.findUnique({ where: { id } });
    return row ? toPolyswapOrderRow(row) : null;
  }

  /**
   * Persisted cursor lives in `listener_state.last_processed_block`. Fall back
   * to MAX(block_number) on first run / pre-cursor environments.
   */
  static async getLatestProcessedBlock(): Promise<number> {
    const state = await prisma.listenerState.findUnique({
      where: { key: "last_processed_block" },
    });
    if (state) return Number(state.value);

    const fallback = await prisma.polyswapOrder.aggregate({ _max: { blockNumber: true } });
    return Number(fallback._max.blockNumber ?? 0);
  }

  static async setLatestProcessedBlock(blockNumber: number): Promise<void> {
    await prisma.listenerState.upsert({
      where: { key: "last_processed_block" },
      create: { key: "last_processed_block", value: BigInt(blockNumber) },
      update: { value: BigInt(blockNumber), updatedAt: new Date() },
    });
  }

  static async getPolyswapOrdersByBlockRange(
    fromBlock: number,
    toBlock: number,
    limit: number = 100,
    offset: number = 0
  ): Promise<DatabasePolyswapOrder[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { blockNumber: { gte: BigInt(fromBlock), lte: BigInt(toBlock) } },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: limit,
      skip: offset,
    });
    return rows.map(toPolyswapOrderRow);
  }

  static async getPolyswapOrdersByPolymarketHash(
    polymarketHash: string
  ): Promise<DatabasePolyswapOrder[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { polymarketOrderHash: polymarketHash },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toPolyswapOrderRow);
  }

  static async updateOrderStatus(
    orderHash: string,
    status: "draft" | "live" | "filled" | "canceled"
  ): Promise<boolean> {
    try {
      const result = await prisma.polyswapOrder.updateMany({
        where: { orderHash },
        data: { status, updatedAt: new Date() },
      });
      return result.count > 0;
    } catch (error) {
      log.error(`failed to update order status for hash ${orderHash}:`, error);
      return false;
    }
  }

  static async updateOrderStatusById(
    orderId: number,
    status: OrderStatus,
    fillDetails?: {
      filledAt?: Date;
      fillTransactionHash?: string;
      fillBlockNumber?: number;
      fillLogIndex?: number;
      actualSellAmount?: string;
      actualBuyAmount?: string;
      feeAmount?: string;
    }
  ): Promise<boolean> {
    const data: Prisma.PolyswapOrderUpdateInput = { status, updatedAt: new Date() };
    if (fillDetails?.filledAt) data.filledAt = fillDetails.filledAt;
    if (fillDetails?.fillTransactionHash) {
      data.fillTransactionHash = fillDetails.fillTransactionHash;
    }
    if (fillDetails?.fillBlockNumber !== undefined) {
      data.fillBlockNumber = BigInt(fillDetails.fillBlockNumber);
    }
    if (fillDetails?.fillLogIndex !== undefined) data.fillLogIndex = fillDetails.fillLogIndex;
    if (fillDetails?.actualSellAmount) {
      data.actualSellAmount = new Prisma.Decimal(fillDetails.actualSellAmount);
    }
    if (fillDetails?.actualBuyAmount) {
      data.actualBuyAmount = new Prisma.Decimal(fillDetails.actualBuyAmount);
    }
    if (fillDetails?.feeAmount) data.feeAmount = new Prisma.Decimal(fillDetails.feeAmount);

    try {
      await prisma.polyswapOrder.update({ where: { id: orderId }, data });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return false;
      }
      log.error(`failed to update order status for id ${orderId}:`, error);
      return false;
    }
  }

  static async setOrderError(
    id: number,
    errorName: string,
    reason: string,
    retryAt: number | null
  ): Promise<void> {
    await prisma.polyswapOrder.update({
      where: { id },
      data: {
        lastErrorName: errorName,
        lastErrorReason: reason,
        lastErrorRetryAt: retryAt === null ? null : BigInt(retryAt),
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  static async clearOrderError(id: number): Promise<void> {
    await prisma.polyswapOrder.update({
      where: { id },
      data: {
        lastErrorName: null,
        lastErrorReason: null,
        lastErrorRetryAt: null,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Stamp `gate_opened_at` the first time the conditional order is observed
   * to be tradeable — i.e. the Polymarket condition has fired. Idempotent:
   * subsequent calls are no-ops because we filter by `gateOpenedAt: null`.
   */
  static async markGateOpened(id: number): Promise<void> {
    await prisma.polyswapOrder.updateMany({
      where: { id, gateOpenedAt: null },
      data: { gateOpenedAt: new Date(), updatedAt: new Date() },
    });
  }

  static async setCowOrderStatus(id: number, status: string): Promise<boolean> {
    try {
      await prisma.polyswapOrder.update({
        where: { id },
        data: { cowOrderStatus: status, updatedAt: new Date() },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return false;
      }
      throw error;
    }
  }

  static async deletePolyswapOrderById(id: number): Promise<void> {
    await prisma.polyswapOrder.delete({ where: { id } });
  }

  static async findDraftsOlderThan(cutoff: Date): Promise<DatabasePolyswapOrder[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { status: "draft", createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPolyswapOrderRow);
  }

  static async updateOrderPolymarketHash(
    orderHash: string,
    polymarketOrderHash: string
  ): Promise<boolean> {
    const result = await prisma.polyswapOrder.updateMany({
      where: { orderHash },
      data: { polymarketOrderHash, updatedAt: new Date() },
    });
    return result.count > 0;
  }

  static async updateOrderPolymarketHashById(
    orderId: number,
    polymarketOrderHash: string
  ): Promise<boolean> {
    try {
      await prisma.polyswapOrder.update({
        where: { id: orderId },
        data: { polymarketOrderHash, updatedAt: new Date() },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return false;
      }
      throw error;
    }
  }

  static async updateOrderTransactionHashById(
    orderId: number,
    transactionHash: string
  ): Promise<boolean> {
    try {
      await prisma.polyswapOrder.update({
        where: { id: orderId },
        data: { transactionHash, status: "live", updatedAt: new Date() },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return false;
      }
      throw error;
    }
  }

  static async getOrdersByStatus(
    status: "draft" | "live" | "filled" | "canceled",
    limit: number = 100,
    offset: number = 0
  ): Promise<DatabasePolyswapOrder[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map(toPolyswapOrderRow);
  }

  static async getPolyswapOrderByHashAndOwner(
    orderHash: string,
    ownerAddress: string
  ): Promise<DatabasePolyswapOrder | null> {
    const row = await prisma.polyswapOrder.findFirst({
      where: { orderHash, owner: ownerAddress.toLowerCase() },
    });
    return row ? toPolyswapOrderRow(row) : null;
  }

  /**
   * Listener catch-up path: stamp the full set of on-chain coordinates and
   * advance the row to "live" in a single update.
   */
  static async updateOrderTransactionDetails(
    orderId: number,
    transactionHash: string,
    blockNumber: number,
    logIndex: number,
    handler: string,
    appData: string,
    orderHash: string,
    orderUid?: string
  ): Promise<boolean> {
    try {
      await prisma.polyswapOrder.update({
        where: { id: orderId },
        data: {
          transactionHash,
          blockNumber: BigInt(blockNumber),
          logIndex,
          handler: handler.toLowerCase(),
          appData,
          orderHash,
          orderUid: orderUid ?? null,
          status: "live",
          updatedAt: new Date(),
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return false;
      }
      throw error;
    }
  }

  static async updateOrderUid(orderHash: string, orderUid: string): Promise<boolean> {
    const result = await prisma.polyswapOrder.updateMany({
      where: { orderHash },
      data: { orderUid, updatedAt: new Date() },
    });
    return result.count > 0;
  }

  static async getPolyswapOrderByUid(orderUid: string): Promise<DatabasePolyswapOrder | null> {
    const row = await prisma.polyswapOrder.findFirst({ where: { orderUid } });
    return row ? toPolyswapOrderRow(row) : null;
  }

  static async getLiveOrdersWithoutUid(): Promise<DatabasePolyswapOrder[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: {
        status: "live",
        OR: [{ orderUid: null }, { orderUid: "" }],
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPolyswapOrderRow);
  }

  static async getLiveOrders(): Promise<DatabasePolyswapOrder[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { status: "live" },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPolyswapOrderRow);
  }

  static async getAllPolyswapOrders(): Promise<DatabasePolyswapOrder[]> {
    const rows = await prisma.polyswapOrder.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toPolyswapOrderRow);
  }

  // ============================================================
  // Sold Positions
  // ============================================================

  static async recordSoldPosition(input: SoldPositionInput): Promise<number> {
    const created = await prisma.soldPosition.create({
      data: {
        assetId: input.assetId,
        conditionId: input.conditionId,
        size: new Prisma.Decimal(input.size),
        sellPrice: new Prisma.Decimal(input.sellPrice),
        currentPrice: new Prisma.Decimal(input.currentPrice),
        orderId: input.orderId,
        marketTitle: input.marketTitle,
        outcome: input.outcome,
      },
      select: { id: true },
    });
    return created.id;
  }

  static async getRecentlySoldPositions(hoursAgo: number = 24): Promise<SoldPosition[]> {
    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const rows = await prisma.soldPosition.findMany({
      where: { soldAt: { gt: since } },
      orderBy: { soldAt: "desc" },
    });
    return rows.map(toSoldPositionRow);
  }

  static async getSoldPositionByAsset(assetId: string): Promise<SoldPosition | null> {
    const row = await prisma.soldPosition.findFirst({
      where: { assetId },
      orderBy: { soldAt: "desc" },
    });
    return row ? toSoldPositionRow(row) : null;
  }

  static async getAllSoldPositions(
    limit: number = 100,
    offset: number = 0
  ): Promise<SoldPosition[]> {
    const rows = await prisma.soldPosition.findMany({
      orderBy: { soldAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map(toSoldPositionRow);
  }

  static async getSoldPositionsStats(): Promise<{
    totalSold: number;
    totalValue: number;
    last24Hours: number;
  }> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalSold, last24Hours, rows] = await Promise.all([
      prisma.soldPosition.count(),
      prisma.soldPosition.count({ where: { soldAt: { gt: since24h } } }),
      prisma.soldPosition.findMany({ select: { size: true, sellPrice: true } }),
    ]);
    const totalValue = rows.reduce(
      (sum, r) => sum + decimalToNumber(r.size) * decimalToNumber(r.sellPrice),
      0
    );
    return { totalSold, totalValue, last24Hours };
  }

  static async cleanupOldSoldPositions(daysOld: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const { count } = await prisma.soldPosition.deleteMany({
      where: { soldAt: { lt: cutoff } },
    });
    return count;
  }

  static async deleteSoldPositionByOrderId(orderId: string): Promise<boolean> {
    const { count } = await prisma.soldPosition.deleteMany({ where: { orderId } });
    return count > 0;
  }

  static async deleteSoldPositionByAssetId(assetId: string): Promise<number> {
    const { count } = await prisma.soldPosition.deleteMany({ where: { assetId } });
    return count;
  }

  static async cleanupFailedSoldPositions(): Promise<number> {
    const { count } = await prisma.soldPosition.deleteMany({
      where: { OR: [{ orderId: "unknown" }, { orderId: "" }] },
    });
    if (count > 0) log.info(`cleaned up ${count} failed sold-position record(s)`);
    return count;
  }

  // ============================================================
  // Internal helpers for the search query
  // ============================================================

  private static buildSearchWhere(opts: SearchMarketsOptions): Prisma.Sql {
    const { q, category, categories, volumeMin = 0, liquidityMin = 0 } = opts;

    const fragments: Prisma.Sql[] = [
      Prisma.sql`active = TRUE`,
      Prisma.sql`volume >= ${volumeMin}`,
      Prisma.sql`liquidity >= ${liquidityMin}`,
    ];

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
  private static buildOrderBy(
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
}
