import { encodeFunctionData, erc20Abi, getAddress, maxUint256, type Address } from "viem";
import type { MarketRow } from "@/backend/interfaces/Market";
import type {
  ConditionalOrderParams,
  PolymarketSentinelRow,
  PolyswapOrderData,
} from "@/backend/interfaces/PolyswapOrder";
import { createLogger } from "@/backend/logger";
import type { CreateOrderInput } from "@/backend/orders/createOrderRequest";
import { getPolyswapHandlerAddress } from "@/backend/polymarket/config";
import { createCowAppDataHashOrDefault } from "@/backend/services/cowAppDataService";
import { marketRepository } from "@/backend/db/marketRepository";
import { orderRepository } from "@/backend/db/orderRepository";
import { getOrCreateSentinel } from "@/backend/services/polymarketSentinelService";
import { getClobAvailability } from "@/backend/polymarket/status";
import { buildFallbackHandlerSetupTx } from "@/backend/services/safeFallbackHandlerService";
import {
  createConditionalOrderParams,
  encodeCreateWithContextCallData,
} from "@/backend/services/transactionEncodingService";
import { calculateOrderHash } from "@/backend/utils/conditionalOrderCodec";
import type { ApiErrorOptions } from "@/server/apiError";
import { COMPOSABLE_COW } from "@/shared/contracts";
import {
  getTradingAssetIds,
  parseProtocolVersion,
  type ProtocolVersion,
} from "@/shared/polymarket/protocol";
import { checkPostOnlyBuy, postOnlyCrossingMessage } from "@/shared/orders/postOnly";
import { isPolymarketSentinelPostOnly } from "@/shared/env";
import { fetchClobBestAsk } from "@/shared/polymarket/clob";

const log = createLogger("api-orders");

const VAULT_RELAYER: Address = getAddress(
  process.env.VAULT_RELAYER ?? "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"
);
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEADLINE_DAYS = 30;
const MAX_DEADLINE_DAYS = 365;
const MIN_SECONDS_BEFORE_DEADLINE = 180;

/** Carries the exact API error an order-creation step wants returned. */
export class OrderRejectedError extends Error {
  constructor(readonly rejection: ApiErrorOptions) {
    super(rejection.error);
  }
}

function reject(rejection: ApiErrorOptions): never {
  throw new OrderRejectedError(rejection);
}

interface OrderPlan {
  input: CreateOrderInput;
  market: MarketRow;
  protocolVersion: ProtocolVersion;
  tokenId: string;
  postOnly: boolean;
  deadline: Date;
  explicitDeadline: boolean;
}

async function loadMarket(marketId: string): Promise<MarketRow> {
  const market = await marketRepository.getMarketById(marketId);
  if (market) return market;
  reject({
    status: 404,
    error: "Market not found",
    message: `No market with id: ${marketId}`,
  });
}

function defaultDeadline(market: MarketRow, startDate: Date): Date {
  const marketEnd = market.end_date ? new Date(market.end_date) : null;
  const deadline =
    marketEnd && marketEnd.getTime() > startDate.getTime()
      ? marketEnd
      : new Date(startDate.getTime() + DEFAULT_DEADLINE_DAYS * DAY_MS);
  const maxDeadline = new Date(startDate.getTime() + MAX_DEADLINE_DAYS * DAY_MS);
  return deadline.getTime() > maxDeadline.getTime() ? maxDeadline : deadline;
}

function resolveDeadline(
  requestedDeadline: string | undefined,
  market: MarketRow,
  startDate: Date
): { deadline: Date; explicitDeadline: boolean } {
  const explicitDeadline = Boolean(requestedDeadline);
  const deadline = requestedDeadline
    ? new Date(requestedDeadline)
    : defaultDeadline(market, startDate);

  if (deadline <= startDate) {
    reject({ status: 400, error: "deadline must be after startDate" });
  }
  return { deadline, explicitDeadline };
}

function resolveTradingIntegration(market: MarketRow): {
  protocolVersion: ProtocolVersion;
  tradingIds: string[];
} {
  try {
    const protocolVersion = parseProtocolVersion(market.protocol_version);
    const tradingIds = getTradingAssetIds({
      protocolVersion,
      clobTokenIds: market.clob_token_ids,
      positionIds: market.position_ids,
      outcomes: market.outcomes,
    });
    getPolyswapHandlerAddress({ protocolVersion, negRisk: market.neg_risk });
    return { protocolVersion, tradingIds };
  } catch (error) {
    reject({
      status: 503,
      error: "Market trading integration is not ready",
      cause: error,
    });
  }
}

function assertDeadlineIsReachable(deadline: Date): void {
  const earliest = Math.floor(Date.now() / 1000) + MIN_SECONDS_BEFORE_DEADLINE;
  if (Math.floor(deadline.getTime() / 1000) < earliest) {
    reject({ status: 400, error: "deadline must be at least three minutes in the future" });
  }
}

function resolveOutcomeTokenId(
  market: MarketRow,
  selectedOutcome: string,
  tradingIds: string[]
): string {
  const outcomes: string[] = Array.isArray(market.outcomes) ? market.outcomes : [];
  if (outcomes.length === 0) {
    reject({ status: 500, error: "Market data is incomplete" });
  }

  const outcomeIndex = outcomes.indexOf(selectedOutcome);
  if (outcomeIndex === -1) {
    reject({
      status: 400,
      error: "Invalid outcome",
      message: `'${selectedOutcome}' is not valid. Valid outcomes: ${outcomes.join(", ")}`,
    });
  }
  if (outcomeIndex >= tradingIds.length) {
    reject({ status: 500, error: "Market data is incomplete" });
  }

  const tokenId = tradingIds[outcomeIndex];
  if (tokenId === undefined) {
    reject({ status: 500, error: "Selected outcome has no Polymarket token ID" });
  }
  return tokenId;
}

async function fetchBestAskOrReject(tokenId: string): Promise<number | null> {
  try {
    return await fetchClobBestAsk(tokenId);
  } catch (error) {
    reject({
      status: 503,
      error: "Polymarket order book unavailable",
      message: "The live Polymarket order book could not be checked. Please try again.",
      code: "ORDER_BOOK_UNAVAILABLE",
      cause: error,
    });
  }
}

async function assertPostOnlyDoesNotCross(tokenId: string, betPercentage: number): Promise<void> {
  const bestAsk = await fetchBestAskOrReject(tokenId);
  const check = checkPostOnlyBuy(betPercentage, bestAsk);
  if (check.status === "unavailable") {
    reject({
      status: 503,
      error: "Polymarket order book unavailable",
      message: "The live Polymarket order book returned an invalid price. Please try again.",
      code: "ORDER_BOOK_UNAVAILABLE",
    });
  }
  if (check.status === "crosses") {
    reject({
      status: 409,
      error: "Order crosses the live book",
      message: postOnlyCrossingMessage(check),
      code: "POST_ONLY_WOULD_CROSS",
    });
  }
}

async function rejectSentinelFailure(polymarketError: unknown): Promise<never> {
  const clob = await getClobAvailability();
  if (!clob.available) {
    reject({
      status: 503,
      error: "Polymarket unavailable",
      message: "Polymarket is temporarily unavailable. Please try again later.",
      cause: polymarketError,
    });
  }
  reject({
    status: 502,
    error: "Polymarket sentinel preparation failed",
    cause: polymarketError,
  });
}

async function prepareSentinel(plan: OrderPlan): Promise<PolymarketSentinelRow> {
  const { input, market, tokenId } = plan;
  try {
    log.info(
      `preparing sentinel: market=${input.marketId} outcome=${input.selectedOutcome} ` +
        `tokenID=${tokenId} price=${input.betPercentage / 100} negRisk=${market.neg_risk}`
    );
    const sentinel = await getOrCreateSentinel({
      marketId: input.marketId,
      tokenId,
      outcomeSelected: input.selectedOutcome,
      priceCents: input.betPercentage,
      negRisk: market.neg_risk,
      protocolVersion: plan.protocolVersion,
      postOnly: plan.postOnly,
      expiration: plan.deadline,
    });
    log.info(
      `using sentinel ${sentinel.polymarket_order_hash} epoch=${sentinel.epoch} status=${sentinel.status}`
    );
    return sentinel;
  } catch (polymarketError) {
    return rejectSentinelFailure(polymarketError);
  }
}

function buildOrderParams(
  plan: OrderPlan,
  sentinel: PolymarketSentinelRow,
  appData: string
): ConditionalOrderParams {
  const { input, market, protocolVersion, deadline } = plan;
  const orderData: PolyswapOrderData = {
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    receiver: input.owner,
    sellAmount: input.sellAmount,
    minBuyAmount: input.minBuyAmount,
    t0: Math.floor(input.startDate.getTime() / 1000).toString(),
    t: Math.floor(deadline.getTime() / 1000).toString(),
    polymarketOrderHash: sentinel.polymarket_order_hash,
    appData,
    polymarketMakerAmount: sentinel.polymarket_maker_amount,
  };
  return createConditionalOrderParams(orderData, {
    negRisk: market.neg_risk,
    protocolVersion,
  });
}

async function saveDraftOrder(
  plan: OrderPlan,
  sentinel: PolymarketSentinelRow,
  params: ConditionalOrderParams,
  orderHash: string,
  appData: string
): Promise<number> {
  const { input, deadline, explicitDeadline } = plan;
  try {
    return await orderRepository.insertPolyswapOrderFromForm({
      orderHash,
      handler: params.handler,
      sellToken: input.sellToken,
      buyToken: input.buyToken,
      sellAmount: input.sellAmount,
      minBuyAmount: input.minBuyAmount,
      startDate: input.startDate.toISOString(),
      deadline: deadline.toISOString(),
      marketId: input.marketId,
      owner: input.owner,
      outcomeSelected: input.selectedOutcome,
      betPercentageValue: input.betPercentage,
      polymarketOrderHash: sentinel.polymarket_order_hash,
      appData,
      salt: params.salt,
      explicitDeadline,
      polymarketMakerAmount: sentinel.polymarket_maker_amount,
      sentinelId: sentinel.id,
    });
  } catch (dbError) {
    reject({ status: 500, error: "Failed to save order", cause: dbError });
  }
}

async function planOrder(input: CreateOrderInput): Promise<OrderPlan> {
  const market = await loadMarket(input.marketId);
  const { deadline, explicitDeadline } = resolveDeadline(
    input.requestedDeadline,
    market,
    input.startDate
  );
  const { protocolVersion, tradingIds } = resolveTradingIntegration(market);
  assertDeadlineIsReachable(deadline);
  const tokenId = resolveOutcomeTokenId(market, input.selectedOutcome, tradingIds);

  const postOnly = isPolymarketSentinelPostOnly();
  if (postOnly) await assertPostOnlyDoesNotCross(tokenId, input.betPercentage);

  return { input, market, protocolVersion, tokenId, postOnly, deadline, explicitDeadline };
}

/** Prepares the sentinel, saves the draft and returns the transactions the Safe must send. */
export async function createOrder(input: CreateOrderInput) {
  const plan = await planOrder(input);
  const sentinel = await prepareSentinel(plan);
  const appData = await createCowAppDataHashOrDefault();

  const params = buildOrderParams(plan, sentinel, appData);
  const orderHash = calculateOrderHash(params);
  const createCalldata = encodeCreateWithContextCallData(params);
  const approveCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [VAULT_RELAYER, maxUint256],
  });

  const orderId = await saveDraftOrder(plan, sentinel, params, orderHash, appData);

  // Fresh Safes haven't installed CoW's ExtensibleFallbackHandler yet. The setup self-call is
  // returned with the bundle so the frontend can prepend it to whichever path it submits
  // (single create vs. approve+create). Failures here are non-fatal: we just skip the prepend.
  const fallbackSetupTx = await buildFallbackHandlerSetupTx(input.owner);

  return {
    orderId,
    polymarketOrderHash: sentinel.polymarket_order_hash,
    orderHash,
    tx: { to: COMPOSABLE_COW, data: createCalldata, value: "0" },
    batchTx: [
      { to: input.sellToken, data: approveCalldata, value: "0" },
      { to: COMPOSABLE_COW, data: createCalldata, value: "0" },
    ],
    fallbackSetupTx,
    sellToken: input.sellToken,
    sellAmount: input.sellAmount,
    vaultRelayer: VAULT_RELAYER,
  };
}
