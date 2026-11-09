import { fetchNegRisk, updateBalanceAllowance } from "@polymarket/client/actions";
import type { SecureClient } from "@polymarket/client";
import type { Address } from "viem";
import { getPolymarketOrderService, type PolymarketOrderService } from "@/backend/polymarket/clob";
import { orderRepository } from "@/backend/db/orderRepository";
import { createLogger } from "../logger";
import {
  PolymarketInventory,
  inventoryKey,
  sharesFromBalance,
  type InventoryPosition,
} from "../polymarket/inventory";
import { getTradingConfig } from "../polymarket/config";
import type { PolymarketPosition } from "../polymarket/data";

const log = createLogger("position-seller");

/** Sells 5% below the reference price so the position liquidates quickly. */
const LIQUIDATION_PRICE_RATIO = 0.95;

type OrderBook = Awaited<ReturnType<SecureClient["fetchOrderBook"]>>;

interface SellingDesk {
  service: PolymarketOrderService;
  client: SecureClient;
  inventory: PolymarketInventory;
}

interface PlacedSale {
  size: string;
  price: number;
  referencePrice: number;
  orderId: string;
  bookConditionId: string;
}

/** Null when neither the position nor the book gives a price: one is never invented. */
export function computeSellPrice(
  book: Pick<OrderBook, "bids" | "tickSize">,
  metadata?: Pick<PolymarketPosition, "currentPrice">
): { price: number; referencePrice: number } | null {
  const bestBid = Math.max(0, ...book.bids.map((bid) => Number(bid.price)));
  const referencePrice = metadata && metadata.currentPrice > 0 ? metadata.currentPrice : bestBid;
  if (!referencePrice) return null;
  const tick = Number(book.tickSize);
  const discounted = Math.floor((referencePrice * LIQUIDATION_PRICE_RATIO) / tick) * tick;
  return { price: Number(Math.max(tick, discounted).toFixed(6)), referencePrice };
}

/** Shared by the listener and manual seller; discovery/diagnostics never grant approvals. */
export class PolymarketPositionSellerService {
  private static isSelling = false;
  private static passRequested = false;
  private static ownerAddress: Address | null = null;
  private static inventory: PolymarketInventory | null = null;

  static initialize(): void {
    if (this.inventory) return;
    const { publicClient, ownerAddress } = getPolymarketOrderService().getChainReader();
    this.ownerAddress = ownerAddress;
    this.inventory = new PolymarketInventory(publicClient, ownerAddress);
  }

  static getOwnerAddress(): Address | null {
    return this.ownerAddress;
  }

  /** A request during a running pass gets one more pass, since that pass may have read too early. */
  static async sellPositions(): Promise<void> {
    if (this.isSelling) {
      this.passRequested = true;
      return;
    }
    this.isSelling = true;
    try {
      do {
        this.passRequested = false;
        await this.runSellPass();
      } while (this.passRequested);
    } finally {
      this.isSelling = false;
    }
  }

  private static async runSellPass(): Promise<void> {
    try {
      const desk = await this.openSellingDesk();
      const positions = await this.listSellablePositions(desk);
      const soldAssets = new Set<string>();
      for (const position of positions) {
        if (soldAssets.has(position.assetId)) continue;
        if (await this.sellPosition(position, desk)) soldAssets.add(position.assetId);
      }
    } catch (error) {
      log.error("Position selling pass failed:", error);
    }
  }

  private static async openSellingDesk(): Promise<SellingDesk> {
    this.initialize();
    const service = getPolymarketOrderService();
    await service.initialize();
    const client = service.getClient();
    const inventory = this.inventory;
    if (!client || !inventory) throw new Error("Position seller is not initialized");
    return { service, client, inventory };
  }

  private static async listSellablePositions({
    service,
    inventory,
  }: SellingDesk): Promise<InventoryPosition[]> {
    const positions = await inventory.read({
      skipRedeemable: true,
      onApiError: (error) => log.warn("Position API unavailable; scanning both ledgers:", error),
      onScanError: (error, protocolVersion) =>
        log.warn(`Position transfer scan failed (${protocolVersion ?? "block number"}):`, error),
    });
    const openSells = new Set<string>(
      (await service.getOpenOrders())
        .filter((order) => order.side === "SELL")
        .map((order) => order.assetId)
    );
    const seen = new Set<string>();
    return positions.filter((position) => {
      const key = inventoryKey(position.protocolVersion, position.assetId);
      if (seen.has(key) || openSells.has(position.assetId)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Returns whether an order was placed. A failed sale must not stop the rest of the pass. */
  private static async sellPosition(
    position: InventoryPosition,
    desk: SellingDesk
  ): Promise<boolean> {
    try {
      return await this.placeSellOrder(position, desk);
    } catch (error) {
      log.error(
        `Could not sell ${inventoryKey(position.protocolVersion, position.assetId)}:`,
        error
      );
      return false;
    }
  }

  private static async placeSellOrder(
    position: InventoryPosition,
    { service, client, inventory }: SellingDesk
  ): Promise<boolean> {
    const { assetId, protocolVersion, metadata } = position;
    const negRisk = metadata?.negRisk ?? (await fetchNegRisk(client, { assetId }));
    const context = { protocolVersion, negRisk };
    const book = await client.fetchOrderBook({ assetId });
    const quote = computeSellPrice(book, metadata);
    if (!quote) return false;

    // Re-read after discovery so fills/transfers cannot leave a stale sell quantity.
    const balance = await inventory.balance(assetId, protocolVersion);
    if (balance === 0n) return false;
    const size = sharesFromBalance(balance);

    await service.ensureTradingApprovals(context);
    await updateBalanceAllowance(client, {
      assetId,
      assetType: getTradingConfig(context).assetType,
    });
    const { response } = await service.postGTCOrder({
      ...context,
      tokenID: assetId,
      price: quote.price,
      side: "SELL",
      size,
    });

    await this.recordSale(position, {
      size,
      price: quote.price,
      referencePrice: quote.referencePrice,
      orderId: response.orderId,
      bookConditionId: book.conditionId,
    });
    log.info(
      `Placed ${protocolVersion} SELL ${response.orderId} for ${size} shares on ${getTradingConfig(context).exchange}`
    );
    return true;
  }

  /** The order is already on the book, so a failed audit write must not fail the sale. */
  private static async recordSale(position: InventoryPosition, sale: PlacedSale): Promise<void> {
    const { assetId, protocolVersion, metadata } = position;
    try {
      await orderRepository.recordSoldPosition({
        assetId,
        conditionId: metadata?.conditionId ?? sale.bookConditionId,
        protocolVersion,
        size: sale.size,
        sellPrice: sale.price,
        currentPrice: sale.referencePrice,
        orderId: sale.orderId,
        marketTitle: metadata?.title ?? assetId,
        outcome: metadata?.outcome ?? "Unknown",
      });
    } catch (error) {
      log.warn("Sale placed but audit record failed:", error);
    }
  }
}
