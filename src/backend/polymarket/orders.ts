import { OrderSide, OrderType, type SignedOrder } from "@polymarket/client";
import { hashTypedData, isAddress, isHex, type Address, type Hex } from "viem";
import { assertAssetId } from "../../lib/polymarket/protocol";
import { getTradingConfig, type TradingContext } from "./config";

const ORDER_FIELDS = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "signer", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "side", type: "uint8" },
  { name: "signatureType", type: "uint8" },
  { name: "timestamp", type: "uint256" },
  { name: "metadata", type: "bytes32" },
  { name: "builder", type: "bytes32" },
] as const;

export const ORDER_STATUS_ABI = [
  {
    type: "function",
    name: "getOrderStatus",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "orderHash" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "filled", type: "bool" },
          { name: "remaining", type: "uint256" },
        ],
      },
    ],
  },
] as const;

/** The same wire struct is used by CTFExchangeV2 and ExchangeV3. */
export function computePolymarketOrderHash(order: SignedOrder, context: TradingContext): Hex {
  const { exchange, domainVersion } = getTradingConfig(context);
  return hashTypedData({
    domain: {
      name: "Polymarket CTF Exchange",
      version: domainVersion,
      chainId: 137,
      verifyingContract: exchange,
    },
    types: { Order: ORDER_FIELDS },
    primaryType: "Order",
    message: {
      salt: BigInt(order.salt),
      maker: order.maker as Address,
      signer: order.signer as Address,
      tokenId: BigInt(order.tokenId),
      makerAmount: BigInt(order.makerAmount),
      takerAmount: BigInt(order.takerAmount),
      side: order.side === OrderSide.BUY ? 0 : 1,
      signatureType: order.signatureType,
      timestamp: BigInt(order.timestamp),
      metadata: order.metadata as Hex,
      builder: order.builder as Hex,
    },
  });
}

export type SignedOrderFormat = "clob-v2" | "unified-v1";

/** Normalize old JSON without re-signing or changing any hashed field. */
export function parseStoredSignedOrder(
  value: unknown,
  format: string,
  postOnly: boolean
): SignedOrder {
  if (format !== "clob-v2" && format !== "unified-v1") {
    throw new Error("Unsupported stored order format");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid stored Polymarket order");
  }
  const order = value as Record<string, unknown>;
  for (const field of ["salt", "tokenId", "makerAmount", "takerAmount", "timestamp"]) {
    if (
      typeof order[field] !== "string" ||
      !/^[0-9]+$/.test(order[field] as string) ||
      BigInt(order[field] as string) >= 1n << 256n
    ) {
      throw new Error(`Invalid stored order ${field}`);
    }
  }
  assertAssetId(order.tokenId);
  if (BigInt(order.makerAmount as string) === 0n || BigInt(order.takerAmount as string) === 0n) {
    throw new Error("Invalid stored order amounts");
  }
  if (!isAddress(String(order.maker)) || !isAddress(String(order.signer))) {
    throw new Error("Invalid stored order signer");
  }
  for (const field of ["metadata", "builder"]) {
    if (typeof order[field] !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(order[field] as string)) {
      throw new Error(`Invalid stored order ${field}`);
    }
  }
  if (order.side !== OrderSide.BUY && order.side !== OrderSide.SELL) {
    throw new Error("Invalid stored order side");
  }
  if (
    !Number.isInteger(order.signatureType) ||
    Number(order.signatureType) < 0 ||
    Number(order.signatureType) > 3
  ) {
    throw new Error("Invalid signature type");
  }
  if (
    typeof order.signature !== "string" ||
    !isHex(order.signature) ||
    order.signature.length <= 2
  ) {
    throw new Error("Invalid stored signature");
  }
  if (
    typeof order.expiration !== "number" &&
    (typeof order.expiration !== "string" || !/^[0-9]+$/.test(order.expiration))
  ) {
    throw new Error("Invalid stored expiration");
  }
  const expiration = Number(order.expiration);
  if (!Number.isSafeInteger(expiration) || expiration <= 0) {
    throw new Error("Invalid stored expiration");
  }
  if (
    format === "unified-v1" &&
    (order.orderType !== OrderType.GTD || Boolean(order.postOnly) !== postOnly)
  ) {
    throw new Error("Stored order submission policy mismatch");
  }
  return { ...order, expiration, orderType: OrderType.GTD, postOnly } as SignedOrder;
}

export function hasReachedFillGate(
  status: { filled: boolean; remaining: bigint },
  makerAmount: bigint
): boolean {
  if (makerAmount <= 0n) throw new Error("Invalid maker amount");
  const consumed =
    status.remaining === 0n
      ? status.filled
        ? makerAmount
        : 0n
      : makerAmount > status.remaining
        ? makerAmount - status.remaining
        : 0n;
  return consumed * 10_000n >= makerAmount * 1_000n;
}
