import {
  getTradingConfig,
  getPolyswapHandlerAddress,
  type TradingContext,
} from "../polymarket/config";
import { hasReachedFillGate } from "../polymarket/orders";
import type { ProtocolVersion } from "@/shared/polymarket/protocol";
import { Prisma } from "@prisma/client";
import type { Hex } from "viem";
import { sentinelRepository } from "@/backend/db/sentinelRepository";
import { getPolymarketOrderService, type PolymarketOrderService } from "@/backend/polymarket/clob";
import type { PolymarketSentinelRow } from "../interfaces/PolyswapOrder";
import { createLogger } from "../logger";

const log = createLogger("polymarket-sentinel");
const PREPARE_ATTEMPTS = 3;

interface SentinelBucket {
  marketId: string;
  tokenId: string;
  outcomeSelected: string;
  priceCents: number;
  negRisk: boolean;
  protocolVersion: ProtocolVersion;
  postOnly: boolean;
  expiration: Date;
}

interface SentinelAuthorization {
  handler: string;
  polymarketOrderHash: string;
  makerAmount: string | null;
}

type ReusableLookup =
  | { outcome: "reusable"; sentinel: PolymarketSentinelRow }
  /** The match had already filled and is now marked so: look again before preparing. */
  | { outcome: "consumed" }
  | { outcome: "none" };

function sentinelContext(sentinel: PolymarketSentinelRow): TradingContext {
  return {
    protocolVersion: sentinel.protocol_version,
    negRisk: sentinel.neg_risk,
    exchangeAddress: sentinel.exchange_address,
  };
}

async function initializedOrderService(): Promise<PolymarketOrderService> {
  const polymarket = getPolymarketOrderService();
  await polymarket.initialize();
  return polymarket;
}

async function isFilledOnChain(
  polymarket: PolymarketOrderService,
  sentinel: PolymarketSentinelRow
): Promise<boolean> {
  const chainStatus = await polymarket.getOnChainOrderStatus(
    sentinel.polymarket_order_hash as Hex,
    sentinelContext(sentinel)
  );
  return (
    chainStatus.filled || hasReachedFillGate(chainStatus, BigInt(sentinel.polymarket_maker_amount))
  );
}

async function findValidReusableSentinel(bucket: SentinelBucket): Promise<ReusableLookup> {
  const reusable = await sentinelRepository.findReusableSentinel({
    marketId: bucket.marketId,
    protocolVersion: bucket.protocolVersion,
    tokenId: bucket.tokenId,
    priceCents: bucket.priceCents,
    postOnly: bucket.postOnly,
    minimumExpiration: bucket.expiration,
  });
  if (
    !reusable ||
    getTradingConfig(sentinelContext(reusable)).exchange.toLowerCase() !==
      getTradingConfig(bucket).exchange.toLowerCase()
  ) {
    return { outcome: "none" };
  }
  if (reusable.status !== "live") return { outcome: "reusable", sentinel: reusable };

  const polymarket = await initializedOrderService();
  if (!(await isFilledOnChain(polymarket, reusable))) {
    return { outcome: "reusable", sentinel: reusable };
  }
  await sentinelRepository.markSentinelFilled(reusable.id);
  return { outcome: "consumed" };
}

/** Returns null when a concurrent request created the same sentinel first. */
async function prepareNewSentinel(bucket: SentinelBucket): Promise<PolymarketSentinelRow | null> {
  const epoch = await sentinelRepository.getNextSentinelEpoch(bucket);
  const polymarket = await initializedOrderService();
  const prepared = await polymarket.prepareGTDOrder({
    tokenID: bucket.tokenId,
    price: bucket.priceCents / 100,
    side: "BUY",
    size: 5,
    expiration: Math.floor(bucket.expiration.getTime() / 1000),
    negRisk: bucket.negRisk,
    protocolVersion: bucket.protocolVersion,
    postOnly: bucket.postOnly,
  });

  try {
    const sentinel = await sentinelRepository.createPreparedSentinel({
      ...bucket,
      epoch,
      polymarketOrderHash: prepared.polymarketOrderHash,
      polymarketMakerAmount: prepared.makerAmount,
      signedOrder: prepared.signedOrder,
      exchangeAddress: prepared.exchangeAddress,
      signedOrderFormat: prepared.signedOrderFormat,
      expiration: new Date(prepared.expiration * 1000),
    });
    log.info(
      `prepared sentinel ${sentinel.polymarket_order_hash} for ${bucket.marketId}/${bucket.outcomeSelected}@${bucket.priceCents}`
    );
    return sentinel;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/**
 * Reuse a live/prepared trigger whenever it covers the requested lifetime.
 * Creating a new sentinel signs an order but deliberately does not submit it.
 */
export async function getOrCreateSentinel(bucket: SentinelBucket): Promise<PolymarketSentinelRow> {
  for (let attempt = 0; attempt < PREPARE_ATTEMPTS; attempt++) {
    const lookup = await findValidReusableSentinel(bucket);
    if (lookup.outcome === "reusable") return lookup.sentinel;
    if (lookup.outcome === "consumed") continue;

    const sentinel = await prepareNewSentinel(bucket);
    if (sentinel) return sentinel;
  }
  throw new Error("Could not prepare a shared Polymarket sentinel after concurrent retries");
}

function assertAuthorizationMatches(
  sentinel: PolymarketSentinelRow,
  authorization: SentinelAuthorization
): void {
  const handler = getPolyswapHandlerAddress(sentinelContext(sentinel));
  if (
    handler.toLowerCase() !== authorization.handler.toLowerCase() ||
    sentinel.polymarket_order_hash.toLowerCase() !==
      authorization.polymarketOrderHash.toLowerCase() ||
    sentinel.polymarket_maker_amount !== authorization.makerAmount
  ) {
    throw new Error("Safe authorization does not match the sentinel protocol and commitments");
  }
}

async function submitSentinel(
  sentinel: PolymarketSentinelRow,
  authorizationTxHash: string
): Promise<void> {
  const polymarket = await initializedOrderService();

  // Recover cleanly if the process posted the sentinel but crashed before
  // persisting its status. A failed lookup throws, so an outage can't cause a post.
  if (await isFilledOnChain(polymarket, sentinel)) {
    await sentinelRepository.markSentinelFilled(sentinel.id);
    return;
  }
  if (await polymarket.findOpenOrder(sentinel.polymarket_order_hash)) {
    await sentinelRepository.markSentinelLive(sentinel.id);
    return;
  }

  await polymarket.postPreparedGTDOrder({
    ...sentinelContext(sentinel),
    signedOrder: sentinel.signed_order,
    signedOrderFormat: sentinel.signed_order_format,
    expectedMakerAmount: sentinel.polymarket_maker_amount,
    expectedTokenId: sentinel.token_id,
    expectedExpiration: Math.floor(sentinel.expiration.getTime() / 1000),
    expectedHash: sentinel.polymarket_order_hash,
    postOnly: sentinel.post_only,
  });
  await sentinelRepository.markSentinelLive(sentinel.id);
  log.info(
    `activated ${sentinel.post_only ? "post-only " : ""}sentinel ${sentinel.polymarket_order_hash} from Safe tx ${authorizationTxHash}`
  );
}

/** Activate a prepared sentinel exactly once after confirmed Safe authorization. */
export async function activateSentinel(
  sentinelId: number,
  authorizationTxHash: string,
  authorization: SentinelAuthorization
): Promise<void> {
  const sentinel = await sentinelRepository.getSentinelById(sentinelId);
  if (!sentinel || sentinel.status === "live" || sentinel.status === "filled") return;
  assertAuthorizationMatches(sentinel, authorization);
  if (sentinel.status === "canceled" || sentinel.status === "failed") {
    throw new Error(`sentinel ${sentinelId} cannot activate from status ${sentinel.status}`);
  }
  if (sentinel.expiration.getTime() <= Date.now()) {
    await sentinelRepository.markSentinelFailed(sentinelId, "Sentinel expired before activation");
    throw new Error(`sentinel ${sentinelId} expired before activation`);
  }

  const claimed = await sentinelRepository.claimSentinelActivation(sentinelId, authorizationTxHash);
  if (!claimed) return;

  try {
    await submitSentinel(sentinel, authorizationTxHash);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sentinelRepository.releaseSentinelActivation(sentinelId, message);
    log.error(`sentinel ${sentinelId} activation failed:`, error);
    throw error;
  }
}
