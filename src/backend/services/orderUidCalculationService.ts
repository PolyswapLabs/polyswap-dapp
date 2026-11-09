import { encodePacked, getAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  type DatabasePolyswapOrder,
  type PolyswapOrderData,
} from "@/backend/interfaces/PolyswapOrder";
import { createLogger } from "@/backend/logger";
import { ORDER_DATA_LAYOUT, ORDER_DATA_LAYOUT_V2 } from "@/backend/utils/conditionalOrderCodec";

const log = createLogger("order-uid");

const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

const getOrderHashAbi = (components: readonly { name: string; type: string }[]) =>
  [
    {
      type: "function",
      name: "getOrderHash",
      stateMutability: "view",
      inputs: [{ type: "tuple", components }],
      outputs: [{ type: "bytes32" }],
    },
  ] as const;

// Legacy 9-field handler and the current 10-field handler (adds polymarketMakerAmount).
const orderHashAbi = getOrderHashAbi(ORDER_DATA_LAYOUT);
const orderHashAbiV2 = getOrderHashAbi(ORDER_DATA_LAYOUT_V2);

/**
 * Service for calculating CoW Protocol order UIDs.
 *
 * The on-chain `getOrderHash` view on the PolySwap handler is the source of
 * truth for the EIP-712 digest; the order UID is the canonical concatenation
 * of `digest ‖ owner ‖ validTo`.
 */
export class OrderUidCalculationService {
  private static publicClient: PublicClient | null = null;

  /**
   * Initialize the service with a viem PublicClient.
   */
  static initialize(publicClient: PublicClient): void {
    this.publicClient = publicClient;
  }

  /**
   * Calculate the order hash by calling `getOrderHash` on the PolySwap handler.
   */
  static async calculateOrderHashOnChain(
    polyswapOrderData: PolyswapOrderData,
    handler: Address
  ): Promise<Hex> {
    if (!this.publicClient) {
      throw new Error("OrderUidCalculationService not initialized with publicClient");
    }

    const handlerAddress = getAddress(handler);

    // The ABI must match the deployed handler's getOrderHash signature: V2 orders carry makerAmount
    // (10-field handler), legacy don't. The field doesn't change the hash (orderFor ignores it).
    const makerAmount = polyswapOrderData.polymarketMakerAmount;
    const isV2 = makerAmount !== undefined && makerAmount !== "" && makerAmount !== "0";

    const order = {
      sellToken: polyswapOrderData.sellToken as Address,
      buyToken: polyswapOrderData.buyToken as Address,
      receiver: polyswapOrderData.receiver as Address,
      sellAmount: BigInt(polyswapOrderData.sellAmount),
      minBuyAmount: BigInt(polyswapOrderData.minBuyAmount),
      t0: BigInt(polyswapOrderData.t0),
      t: BigInt(polyswapOrderData.t),
      polymarketOrderHash: polyswapOrderData.polymarketOrderHash as Hex,
      appData: polyswapOrderData.appData as Hex,
    };

    try {
      const result = await this.publicClient.readContract(
        isV2
          ? {
              address: handlerAddress,
              abi: orderHashAbiV2,
              functionName: "getOrderHash",
              args: [{ ...order, polymarketMakerAmount: BigInt(makerAmount) }],
            }
          : {
              address: handlerAddress,
              abi: orderHashAbi,
              functionName: "getOrderHash",
              args: [order],
            }
      );

      return result;
    } catch (error) {
      log.error("failed to calculate order hash on-chain:", error);
      throw new Error(
        `Failed to calculate order hash on-chain: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Calculate the CoW Protocol order UID.
   * Per CoW Protocol: orderUid = orderDigest (32 bytes) ‖ owner (20 bytes) ‖ validTo (4 bytes)
   * = 56 bytes total (0x + 112 hex chars).
   */
  static calculateOrderUid(orderDigest: Hex, owner: Address, validTo: number): Hex {
    try {
      return encodePacked(["bytes32", "address", "uint32"], [orderDigest, owner, validTo]);
    } catch (error) {
      log.error("failed to calculate order UID:", error);
      throw new Error(
        `Failed to calculate order UID: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Calculate the complete order UID end-to-end: read on-chain digest, then pack.
   * Uses `t` (end time) as `validTo` for the UID.
   */
  static async calculateCompleteOrderUidOnChain(
    polyswapOrderData: PolyswapOrderData,
    owner: Address,
    handler: Address
  ): Promise<Hex> {
    try {
      const orderHash = await this.calculateOrderHashOnChain(polyswapOrderData, handler);
      const validTo = parseInt(polyswapOrderData.t);
      return this.calculateOrderUid(orderHash, owner, validTo);
    } catch (error) {
      log.error("failed to calculate complete order UID on-chain:", error);
      throw new Error(
        `Failed to calculate complete order UID on-chain: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Build PolyswapOrderData from a database row.
   * Defaults `polymarketOrderHash` and `appData` to bytes32 zero when null,
   * matching the legacy behavior used by drafts.
   */
  static createPolyswapOrderDataFromDbOrder(dbOrder: DatabasePolyswapOrder): PolyswapOrderData {
    return {
      sellToken: dbOrder.sell_token,
      buyToken: dbOrder.buy_token,
      receiver: dbOrder.owner, // In PolySwap, the receiver is typically the owner
      sellAmount: dbOrder.sell_amount.toString(),
      minBuyAmount: dbOrder.min_buy_amount.toString(),
      t0: Math.floor(new Date(dbOrder.start_time).getTime() / 1000).toString(),
      t: Math.floor(new Date(dbOrder.end_time).getTime() / 1000).toString(),
      polymarketOrderHash: dbOrder.polymarket_order_hash || ZERO_BYTES32,
      appData: dbOrder.app_data || ZERO_BYTES32,
      polymarketMakerAmount: dbOrder.polymarket_maker_amount ?? "",
    };
  }
}
