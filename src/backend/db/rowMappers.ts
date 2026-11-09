import type {
  Market as PrismaMarket,
  PolymarketSentinel as PrismaPolymarketSentinel,
  PolyswapOrder as PrismaPolyswapOrder,
  Prisma,
} from "@prisma/client";
import { parseProtocolVersion } from "@/shared/polymarket/protocol";
import type { MarketRow } from "@/backend/interfaces/Market";
import type { PolymarketSentinelRow, PolyswapOrderRow } from "@/backend/interfaces/PolyswapOrder";

export type OrderStatus = "draft" | "live" | "filled" | "canceled" | "errored" | "expired";

type CowOrderStatus = NonNullable<PolyswapOrderRow["cow_order_status"]>;

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

export function toMarketRow(m: PrismaMarket): MarketRow {
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
    protocol_version: m.protocolVersion === null ? null : parseProtocolVersion(m.protocolVersion),
    position_ids: m.positionIds,
    condition_id: m.conditionId,
    active: m.active ?? true,
    neg_risk: m.negRisk,
    updated_at: m.updatedAt ?? undefined,
  };
}

export function toPolyswapOrderRow(o: PrismaPolyswapOrder): PolyswapOrderRow {
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

export function toPolymarketSentinelRow(s: PrismaPolymarketSentinel): PolymarketSentinelRow {
  return {
    id: s.id,
    market_id: s.marketId,
    token_id: s.tokenId,
    outcome_selected: s.outcomeSelected,
    price_cents: s.priceCents,
    neg_risk: s.negRisk,
    protocol_version: parseProtocolVersion(s.protocolVersion),
    exchange_address: s.exchangeAddress,
    signed_order_format: s.signedOrderFormat,
    post_only: s.postOnly,
    epoch: s.epoch,
    polymarket_order_hash: s.polymarketOrderHash,
    polymarket_maker_amount: s.polymarketMakerAmount.toString(),
    signed_order: s.signedOrder,
    expiration: s.expiration,
    status: s.status as PolymarketSentinelRow["status"],
    activation_tx_hash: s.activationTxHash,
    last_error: s.lastError,
    activated_at: s.activatedAt,
    filled_at: s.filledAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}
