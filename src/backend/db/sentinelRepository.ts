import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { toPolymarketSentinelRow } from "./rowMappers";
import type { DatabasePolymarketSentinel } from "@/backend/interfaces/PolyswapOrder";
import type { ProtocolVersion } from "@/lib/polymarket/protocol";

export const sentinelRepository = {
  // ============================================================
  // Shared Polymarket sentinels
  // ============================================================

  async findReusableSentinel(input: {
    marketId: string;
    protocolVersion: ProtocolVersion;
    tokenId: string;
    priceCents: number;
    postOnly: boolean;
    minimumExpiration: Date;
  }): Promise<DatabasePolymarketSentinel | null> {
    const row = await prisma.polymarketSentinel.findFirst({
      where: {
        marketId: input.marketId,
        protocolVersion: input.protocolVersion,
        tokenId: input.tokenId,
        priceCents: input.priceCents,
        postOnly: input.postOnly,
        status: { in: ["prepared", "activating", "live"] },
        expiration: { gte: input.minimumExpiration },
      },
      orderBy: { epoch: "desc" },
    });
    return row ? toPolymarketSentinelRow(row) : null;
  },

  async getNextSentinelEpoch(input: {
    marketId: string;
    protocolVersion: ProtocolVersion;
    tokenId: string;
    priceCents: number;
  }): Promise<number> {
    const latest = await prisma.polymarketSentinel.findFirst({
      where: {
        marketId: input.marketId,
        protocolVersion: input.protocolVersion,
        tokenId: input.tokenId,
        priceCents: input.priceCents,
      },
      orderBy: { epoch: "desc" },
      select: { epoch: true },
    });
    return (latest?.epoch ?? 0) + 1;
  },

  async createPreparedSentinel(input: {
    marketId: string;
    protocolVersion: ProtocolVersion;
    tokenId: string;
    outcomeSelected: string;
    priceCents: number;
    negRisk: boolean;
    postOnly: boolean;
    epoch: number;
    polymarketOrderHash: string;
    polymarketMakerAmount: string;
    signedOrder: unknown;
    exchangeAddress: string;
    signedOrderFormat: string;
    expiration: Date;
  }): Promise<DatabasePolymarketSentinel> {
    const row = await prisma.polymarketSentinel.create({
      data: {
        marketId: input.marketId,
        protocolVersion: input.protocolVersion,
        tokenId: input.tokenId,
        outcomeSelected: input.outcomeSelected,
        priceCents: input.priceCents,
        negRisk: input.negRisk,
        postOnly: input.postOnly,
        epoch: input.epoch,
        polymarketOrderHash: input.polymarketOrderHash,
        polymarketMakerAmount: new Prisma.Decimal(input.polymarketMakerAmount),
        signedOrder: input.signedOrder as Prisma.InputJsonValue,
        exchangeAddress: input.exchangeAddress,
        signedOrderFormat: input.signedOrderFormat,
        expiration: input.expiration,
        status: "prepared",
      },
    });
    return toPolymarketSentinelRow(row);
  },

  async getSentinelById(id: number): Promise<DatabasePolymarketSentinel | null> {
    const row = await prisma.polymarketSentinel.findUnique({ where: { id } });
    return row ? toPolymarketSentinelRow(row) : null;
  },

  /** Only one listener invocation may submit a shared sentinel. */
  async claimSentinelActivation(id: number, transactionHash: string): Promise<boolean> {
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
  },

  async markSentinelLive(id: number): Promise<void> {
    await prisma.polymarketSentinel.update({
      where: { id },
      data: {
        status: "live",
        activatedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    });
  },

  async releaseSentinelActivation(id: number, error: string): Promise<void> {
    await prisma.polymarketSentinel.updateMany({
      where: { id, status: "activating" },
      data: { status: "prepared", lastError: error, updatedAt: new Date() },
    });
  },

  async markSentinelFailed(id: number, error: string): Promise<void> {
    await prisma.polymarketSentinel.update({
      where: { id },
      data: { status: "failed", lastError: error, updatedAt: new Date() },
    });
  },

  async markSentinelFilledForOrder(orderId: number): Promise<void> {
    const order = await prisma.polyswapOrder.findUnique({
      where: { id: orderId },
      select: { sentinelId: true },
    });
    if (!order?.sentinelId) return;
    await sentinelRepository.markSentinelFilled(order.sentinelId);
  },

  async markSentinelFilled(id: number): Promise<void> {
    await prisma.polymarketSentinel.updateMany({
      where: { id, status: { in: ["activating", "live"] } },
      data: { status: "filled", filledAt: new Date(), updatedAt: new Date() },
    });
  },
};
