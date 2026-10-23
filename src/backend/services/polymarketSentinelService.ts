import { getTradingConfig, getPolyswapHandlerAddress } from "../polymarket/config";
import { hasReachedFillGate } from "../polymarket/orders";
import type { ProtocolVersion } from "../../lib/polymarket/protocol";
import { Prisma } from "@prisma/client";
import type { Hex } from "viem";
import { DatabaseService } from "./databaseService";
import { getPolymarketOrderService } from "./polymarketOrderService";
import type { DatabasePolymarketSentinel } from "../interfaces/PolyswapOrder";
import { createLogger } from "../logger";

const log = createLogger("polymarket-sentinel");
const PREPARE_ATTEMPTS = 3;

export interface SentinelBucket {
  marketId: string;
  tokenId: string;
  outcomeSelected: string;
  priceCents: number;
  negRisk: boolean;
  protocolVersion: ProtocolVersion;
  postOnly: boolean;
  expiration: Date;
}

/**
 * Reuse a live/prepared trigger whenever it covers the requested lifetime.
 * Creating a new sentinel signs an order but deliberately does not submit it.
 */
export async function getOrCreateSentinel(
  bucket: SentinelBucket
): Promise<DatabasePolymarketSentinel> {
  for (let attempt = 0; attempt < PREPARE_ATTEMPTS; attempt++) {
    const reusable = await DatabaseService.findReusableSentinel({
      marketId: bucket.marketId,
      protocolVersion: bucket.protocolVersion,
      tokenId: bucket.tokenId,
      priceCents: bucket.priceCents,
      postOnly: bucket.postOnly,
      minimumExpiration: bucket.expiration,
    });
    if (
      reusable &&
      getTradingConfig({
        protocolVersion: reusable.protocol_version,
        negRisk: reusable.neg_risk,
        exchangeAddress: reusable.exchange_address,
      }).exchange.toLowerCase() === getTradingConfig(bucket).exchange.toLowerCase()
    ) {
      if (reusable.status !== "live") return reusable;

      const polymarket = getPolymarketOrderService();
      await polymarket.initialize();
      const chainStatus = await polymarket.getOnChainOrderStatus(
        reusable.polymarket_order_hash as Hex,
        {
          protocolVersion: reusable.protocol_version,
          negRisk: reusable.neg_risk,
          exchangeAddress: reusable.exchange_address,
        }
      );
      if (
        !hasReachedFillGate(chainStatus, BigInt(reusable.polymarket_maker_amount)) &&
        !chainStatus.filled
      ) {
        return reusable;
      }

      await DatabaseService.markSentinelFilled(reusable.id);
      continue;
    }

    const epoch = await DatabaseService.getNextSentinelEpoch(bucket);
    const polymarket = getPolymarketOrderService();
    await polymarket.initialize();
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
      const sentinel = await DatabaseService.createPreparedSentinel({
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
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not prepare a shared Polymarket sentinel after concurrent retries");
}

/** Activate a prepared sentinel exactly once after confirmed Safe authorization. */
export async function activateSentinel(
  sentinelId: number,
  authorizationTxHash: string,
  authorization: { handler: string; polymarketOrderHash: string; makerAmount: string | null }
): Promise<void> {
  const sentinel = await DatabaseService.getSentinelById(sentinelId);
  if (!sentinel || sentinel.status === "live" || sentinel.status === "filled") return;
  const handler = getPolyswapHandlerAddress({
    protocolVersion: sentinel.protocol_version,
    negRisk: sentinel.neg_risk,
  });
  if (
    handler.toLowerCase() !== authorization.handler.toLowerCase() ||
    sentinel.polymarket_order_hash.toLowerCase() !==
      authorization.polymarketOrderHash.toLowerCase() ||
    sentinel.polymarket_maker_amount !== authorization.makerAmount
  ) {
    throw new Error("Safe authorization does not match the sentinel protocol and commitments");
  }
  if (sentinel.status === "canceled" || sentinel.status === "failed") {
    throw new Error(`sentinel ${sentinelId} cannot activate from status ${sentinel.status}`);
  }
  if (sentinel.expiration.getTime() <= Date.now()) {
    await DatabaseService.markSentinelFailed(sentinelId, "Sentinel expired before activation");
    throw new Error(`sentinel ${sentinelId} expired before activation`);
  }

  const claimed = await DatabaseService.claimSentinelActivation(sentinelId, authorizationTxHash);
  if (!claimed) return;

  try {
    const polymarket = getPolymarketOrderService();
    await polymarket.initialize();

    // Recover cleanly if the process posted the sentinel but crashed before
    // persisting its live status.
    let existing: { id?: unknown; status?: unknown } | null = null;
    try {
      existing = await polymarket.getOrder(sentinel.polymarket_order_hash);
    } catch (error) {
      // Only a documented not-found may proceed to submission.
      const status =
        error && typeof error === "object"
          ? ((error as { status?: unknown; statusCode?: unknown }).status ??
            (error as { statusCode?: unknown }).statusCode)
          : null;
      if (status !== 404) throw error;
    }
    if (existing?.id?.toString().toLowerCase() === sentinel.polymarket_order_hash.toLowerCase()) {
      const status = String(existing.status).toUpperCase();
      if (status === "LIVE") {
        await DatabaseService.markSentinelLive(sentinelId);
        return;
      }
      if (status === "MATCHED" || status === "FILLED") {
        await DatabaseService.markSentinelFilled(sentinelId);
        return;
      }
      throw new Error(`Existing sentinel is ${status}`);
    }

    await polymarket.postPreparedGTDOrder({
      signedOrder: sentinel.signed_order,
      signedOrderFormat: sentinel.signed_order_format,
      expectedMakerAmount: sentinel.polymarket_maker_amount,
      expectedTokenId: sentinel.token_id,
      expectedExpiration: Math.floor(sentinel.expiration.getTime() / 1000),
      protocolVersion: sentinel.protocol_version,
      exchangeAddress:
        sentinel.exchange_address ??
        getTradingConfig({ protocolVersion: sentinel.protocol_version, negRisk: sentinel.neg_risk })
          .exchange,
      expectedHash: sentinel.polymarket_order_hash,
      negRisk: sentinel.neg_risk,
      postOnly: sentinel.post_only,
    });
    await DatabaseService.markSentinelLive(sentinelId);
    log.info(
      `activated ${sentinel.post_only ? "post-only " : ""}sentinel ${sentinel.polymarket_order_hash} from Safe tx ${authorizationTxHash}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await DatabaseService.releaseSentinelActivation(sentinelId, message);
    log.error(`sentinel ${sentinelId} activation failed:`, error);
    throw error;
  }
}
