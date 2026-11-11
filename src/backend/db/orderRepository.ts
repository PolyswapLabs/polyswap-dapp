import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { toPolyswapOrderRow, type OrderStatus } from "./rowMappers";
import type {
  PolyswapOrderRow,
  PolyswapOrderData,
  PolyswapOrderRecord,
  SoldPositionInput,
} from "@/backend/interfaces/PolyswapOrder";

export const orderRepository = {
  // ============================================================
  // PolySwap Orders
  // ============================================================

  async insertPolyswapOrderFromForm(orderData: {
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
  },

  async insertPolyswapOrder(order: PolyswapOrderRecord): Promise<number> {
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
  },

  /**
   * - If a draft row exists for (order_hash, owner) → upgrade to live
   *   and stamp the on-chain coordinates. Standard frontend-then-listener path.
   * - Otherwise → fresh live insert. Catch-up path when the draft was lost.
   */
  async upsertLiveOrderFromEvent(input: {
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

    const orderId = await orderRepository.insertPolyswapOrder({
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
  },

  async getPolyswapOrdersByOwner(
    ownerAddress: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<PolyswapOrderRow[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { owner: ownerAddress.toLowerCase() },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map(toPolyswapOrderRow);
  },

  async getPolyswapOrderByHash(orderHash: string): Promise<PolyswapOrderRow | null> {
    const row = await prisma.polyswapOrder.findUnique({ where: { orderHash } });
    return row ? toPolyswapOrderRow(row) : null;
  },

  async getPolyswapOrderById(id: number): Promise<PolyswapOrderRow | null> {
    const row = await prisma.polyswapOrder.findUnique({ where: { id } });
    return row ? toPolyswapOrderRow(row) : null;
  },

  async getPolyswapOrdersByBlockRange(
    fromBlock: number,
    toBlock: number,
    limit: number = 100,
    offset: number = 0
  ): Promise<PolyswapOrderRow[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { blockNumber: { gte: BigInt(fromBlock), lte: BigInt(toBlock) } },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: limit,
      skip: offset,
    });
    return rows.map(toPolyswapOrderRow);
  },

  async updateOrderStatusById(
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
      throw error;
    }
  },

  async setOrderError(
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
  },

  async clearOrderError(id: number): Promise<void> {
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
  },

  /**
   * Stamp `gate_opened_at` the first time the conditional order is observed
   * to be tradeable — i.e. the Polymarket condition has fired. Idempotent:
   * subsequent calls are no-ops because we filter by `gateOpenedAt: null`.
   */
  async markGateOpened(id: number): Promise<void> {
    await prisma.polyswapOrder.updateMany({
      where: { id, gateOpenedAt: null },
      data: { gateOpenedAt: new Date(), updatedAt: new Date() },
    });
  },

  async setCowOrderStatus(id: number, status: string): Promise<boolean> {
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
  },

  async deletePolyswapOrderById(id: number): Promise<void> {
    await prisma.polyswapOrder.delete({ where: { id } });
  },

  async findDraftsOlderThan(cutoff: Date): Promise<PolyswapOrderRow[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { status: "draft", createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPolyswapOrderRow);
  },

  async updateOrderUid(orderHash: string, orderUid: string): Promise<boolean> {
    const result = await prisma.polyswapOrder.updateMany({
      where: { orderHash },
      data: { orderUid, updatedAt: new Date() },
    });
    return result.count > 0;
  },

  async getPolyswapOrderByUid(orderUid: string): Promise<PolyswapOrderRow | null> {
    const row = await prisma.polyswapOrder.findFirst({ where: { orderUid } });
    return row ? toPolyswapOrderRow(row) : null;
  },

  async getLiveOrdersWithoutUid(): Promise<PolyswapOrderRow[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: {
        status: "live",
        OR: [{ orderUid: null }, { orderUid: "" }],
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPolyswapOrderRow);
  },

  async getLiveOrders(): Promise<PolyswapOrderRow[]> {
    const rows = await prisma.polyswapOrder.findMany({
      where: { status: "live" },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPolyswapOrderRow);
  },

  // ============================================================
  // Sold Positions
  // ============================================================

  async recordSoldPosition(input: SoldPositionInput): Promise<number> {
    const created = await prisma.soldPosition.create({
      data: {
        assetId: input.assetId,
        protocolVersion: input.protocolVersion,
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
  },
};
