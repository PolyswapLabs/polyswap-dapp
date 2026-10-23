import { fetchNegRisk, updateBalanceAllowance } from "@polymarket/client/actions";
import { createPublicClient, type Address, type Hex } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { resilientHttp } from "../../lib/rpc/resilientHttp";
import { getPolymarketOrderService } from "./polymarketOrderService";
import { DatabaseService } from "./databaseService";
import { createLogger } from "../logger";
import { PolymarketInventory, inventoryKey, sharesFromBalance } from "../polymarket/inventory";
import { getTradingConfig } from "../polymarket/config";
import { PolymarketDataClient } from "../polymarket/data";

const log = createLogger("position-seller");

/** Shared by the listener and manual seller; discovery/diagnostics never grant approvals. */
export class PolymarketPositionSellerService {
  private static sellInterval: NodeJS.Timeout | null = null;
  private static isSelling = false;
  private static ownerAddress: Address | null = null;
  private static inventory: PolymarketInventory | null = null;
  private static readonly data = new PolymarketDataClient();

  private static async initialize(): Promise<void> {
    if (this.inventory) return;
    const pk = process.env.PK;
    if (!pk) throw new Error("Private key (PK) is not configured");
    const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
    const client = createPublicClient({
      chain: polygon,
      transport: resilientHttp(process.env.RPC_URL ?? "https://polygon.drpc.org"),
    });
    this.ownerAddress = account.address;
    this.inventory = new PolymarketInventory(client, account.address, this.data);
  }

  static async startSellRoutine(intervalMinutes = 5): Promise<void> {
    if (this.sellInterval) return;
    await this.initialize();
    void this.checkAndSellPositions();
    this.sellInterval = setInterval(() => {
      void this.checkAndSellPositions();
    }, intervalMinutes * 60_000);
  }

  static stopSellRoutine(): void {
    if (this.sellInterval) clearInterval(this.sellInterval);
    this.sellInterval = null;
  }

  static async checkAndSellPositions(): Promise<void> {
    if (this.isSelling) return;
    this.isSelling = true;
    try {
      await this.initialize();
      const service = getPolymarketOrderService();
      await service.initialize();
      const client = service.getClient();
      const inventory = this.inventory;
      if (!client || !inventory) throw new Error("Position seller is not initialized");
      const positions = await inventory.read({
        onApiError: (error) => log.warn("Position API unavailable; scanning both ledgers:", error),
        onScanError: (error, protocolVersion) =>
          log.warn(`Position transfer scan failed (${protocolVersion ?? "block number"}):`, error),
      });
      const openSells = new Set<string>(
        (await service.getOpenOrders())
          .filter((order) => order.side === "SELL")
          .map((order) => order.assetId)
      );
      const processed = new Set<string>();
      for (const position of positions) {
        const key = inventoryKey(position.protocolVersion, position.assetId);
        if (
          processed.has(key) ||
          openSells.has(position.assetId) ||
          position.metadata?.redeemable
        ) {
          continue;
        }
        processed.add(key);
        try {
          const negRisk =
            position.metadata?.negRisk ??
            (await fetchNegRisk(client, { assetId: position.assetId }));
          const context = { protocolVersion: position.protocolVersion, negRisk };
          const book = await client.fetchOrderBook({ assetId: position.assetId });
          const bestBid = Math.max(0, ...book.bids.map((bid) => Number(bid.price)));
          const referencePrice =
            position.metadata && position.metadata.currentPrice > 0
              ? position.metadata.currentPrice
              : bestBid;
          // Preserve the existing 5% liquidation discount; never invent a price.
          if (!referencePrice) continue;
          const tick = Number(book.tickSize);
          const price = Number(
            Math.max(tick, Math.floor((referencePrice * 0.95) / tick) * tick).toFixed(6)
          );
          // Re-read after discovery so fills/transfers cannot leave a stale sell quantity.
          const balance = await inventory.balance(position.assetId, position.protocolVersion);
          if (balance === 0n) continue;
          const size = sharesFromBalance(balance);
          await service.ensureTradingApprovals(context);
          await updateBalanceAllowance(client, {
            assetId: position.assetId,
            assetType: getTradingConfig(context).assetType,
          });
          const { response } = await service.postGTCOrder({
            ...context,
            tokenID: position.assetId,
            price,
            side: "SELL",
            size,
          });
          openSells.add(position.assetId);
          try {
            await DatabaseService.recordSoldPosition({
              assetId: position.assetId,
              conditionId: position.metadata?.conditionId ?? book.conditionId,
              protocolVersion: position.protocolVersion,
              size,
              sellPrice: price,
              currentPrice: referencePrice,
              orderId: response.orderId,
              marketTitle: position.metadata?.title ?? position.assetId,
              outcome: position.metadata?.outcome ?? "Unknown",
            });
          } catch (error) {
            log.warn("Sale placed but audit record failed:", error);
          }
          log.info(
            `Placed ${position.protocolVersion} SELL ${response.orderId} for ${size} shares on ${getTradingConfig(context).exchange}`
          );
        } catch (error) {
          log.error(`Could not sell ${key}:`, error);
        }
      }
    } catch (error) {
      log.error("Position selling pass failed:", error);
    } finally {
      this.isSelling = false;
    }
  }

  static async triggerSell(): Promise<void> {
    await this.checkAndSellPositions();
  }
  static getStatus() {
    return {
      isRunning: this.sellInterval !== null,
      isSelling: this.isSelling,
      ownerAddress: this.ownerAddress,
    };
  }
}
