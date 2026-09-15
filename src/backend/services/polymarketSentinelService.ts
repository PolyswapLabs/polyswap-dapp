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
      tokenId: bucket.tokenId,
      priceCents: bucket.priceCents,
      postOnly: bucket.postOnly,
      minimumExpiration: bucket.expiration,
    });
    if (reusable) {
      if (reusable.status !== "live") return reusable;

      const polymarket = getPolymarketOrderService();
      await polymarket.initialize();
      const chainStatus = await polymarket.getOnChainOrderStatus(
        reusable.polymarket_order_hash as Hex,
        reusable.neg_risk
      );
      if (!chainStatus.isFilledOrCancelled) return reusable;

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
    });

    try {
      const sentinel = await DatabaseService.createPreparedSentinel({
        ...bucket,
        epoch,
        polymarketOrderHash: prepared.polymarketOrderHash,
        polymarketMakerAmount: prepared.makerAmount,
        signedOrder: prepared.signedOrder,
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
  authorizationTxHash: string
): Promise<void> {
  const sentinel = await DatabaseService.getSentinelById(sentinelId);
  if (!sentinel || sentinel.status === "live" || sentinel.status === "filled") return;
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
    try {
      const existing = (await polymarket.getOrder(sentinel.polymarket_order_hash)) as {
        id?: unknown;
        status?: unknown;
      };
      if (
        typeof existing.id === "string" &&
        existing.id.toLowerCase() === sentinel.polymarket_order_hash.toLowerCase()
      ) {
        if (typeof existing.status === "string" && existing.status.includes("LIVE")) {
          await DatabaseService.markSentinelLive(sentinelId);
          return;
        }
        await DatabaseService.markSentinelFilled(sentinelId);
        return;
      }
    } catch {
      // Not found is the expected state before first activation.
    }

    await polymarket.postPreparedGTDOrder({
      signedOrder: sentinel.signed_order,
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
