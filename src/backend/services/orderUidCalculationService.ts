import {
  encodePacked,
  getAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { type PolyswapOrderRow, type PolyswapOrderData } from "@/backend/interfaces/PolyswapOrder";
import { orderRepository } from "@/backend/db/orderRepository";
import { ORDER_DATA_LAYOUT, ORDER_DATA_LAYOUT_V2 } from "@/backend/utils/conditionalOrderCodec";

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

/** The on-chain `getOrderHash` view on the PolySwap handler is the source of truth for the digest. */
async function readOrderDigest(
  client: PublicClient,
  orderData: PolyswapOrderData,
  handler: Address
): Promise<Hex> {
  const address = getAddress(handler);

  // The ABI must match the deployed handler's getOrderHash signature: V2 orders carry makerAmount
  // (10-field handler), legacy don't. The field doesn't change the hash (orderFor ignores it).
  const makerAmount = orderData.polymarketMakerAmount;
  const isV2 = makerAmount !== undefined && makerAmount !== "" && makerAmount !== "0";

  const order = {
    sellToken: orderData.sellToken as Address,
    buyToken: orderData.buyToken as Address,
    receiver: orderData.receiver as Address,
    sellAmount: BigInt(orderData.sellAmount),
    minBuyAmount: BigInt(orderData.minBuyAmount),
    t0: BigInt(orderData.t0),
    t: BigInt(orderData.t),
    polymarketOrderHash: orderData.polymarketOrderHash as Hex,
    appData: orderData.appData as Hex,
  };

  return client.readContract(
    isV2
      ? {
          address,
          abi: orderHashAbiV2,
          functionName: "getOrderHash",
          args: [{ ...order, polymarketMakerAmount: BigInt(makerAmount) }],
        }
      : { address, abi: orderHashAbi, functionName: "getOrderHash", args: [order] }
  );
}

/**
 * Reads the digest on-chain and packs the CoW Protocol UID:
 * digest (32 bytes) ‖ owner (20 bytes) ‖ validTo (4 bytes), with `t` (end time) as validTo.
 */
async function calculateOrderUidOnChain(
  client: PublicClient,
  orderData: PolyswapOrderData,
  owner: Address,
  handler: Address
): Promise<Hex> {
  try {
    const digest = await readOrderDigest(client, orderData, handler);
    const validTo = parseInt(orderData.t);
    return encodePacked(["bytes32", "address", "uint32"], [digest, owner, validTo]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to calculate complete order UID on-chain: ${detail}`, { cause: error });
  }
}

/**
 * Defaults `polymarketOrderHash` and `appData` to bytes32 zero when null, matching the legacy
 * behavior used by drafts. In PolySwap the receiver is the owner.
 */
function createPolyswapOrderDataFromDbOrder(dbOrder: PolyswapOrderRow): PolyswapOrderData {
  return {
    sellToken: dbOrder.sell_token,
    buyToken: dbOrder.buy_token,
    receiver: dbOrder.owner,
    sellAmount: dbOrder.sell_amount.toString(),
    minBuyAmount: dbOrder.min_buy_amount.toString(),
    t0: Math.floor(new Date(dbOrder.start_time).getTime() / 1000).toString(),
    t: Math.floor(new Date(dbOrder.end_time).getTime() / 1000).toString(),
    polymarketOrderHash: dbOrder.polymarket_order_hash || zeroHash,
    appData: dbOrder.app_data || zeroHash,
    polymarketMakerAmount: dbOrder.polymarket_maker_amount ?? "",
  };
}

interface OrderUidSource {
  orderHash: string;
  data: PolyswapOrderData;
  owner: Address;
  handler: Address;
}

/** Computes the UID and saves it on the order row. Both fill-detection paths look orders up by it. */
export async function storeOrderUid(client: PublicClient, source: OrderUidSource): Promise<Hex> {
  const uid = await calculateOrderUidOnChain(client, source.data, source.owner, source.handler);
  await orderRepository.updateOrderUid(source.orderHash, uid);
  return uid;
}

export async function storeDbOrderUid(
  client: PublicClient,
  order: PolyswapOrderRow,
  orderHash: string
): Promise<Hex> {
  return storeOrderUid(client, {
    orderHash,
    data: createPolyswapOrderDataFromDbOrder(order),
    owner: order.owner as Address,
    handler: order.handler as Address,
  });
}
