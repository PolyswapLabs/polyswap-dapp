import {
  decodeAbiParameters,
  decodeErrorResult,
  encodeAbiParameters,
  keccak256,
  type Hex,
} from "viem";
import {
  type ConditionalOrderParams,
  type PolyswapOrderData,
} from "@/backend/interfaces/PolyswapOrder";

const ORDER_DATA_TUPLE = [
  { type: "address", name: "sellToken" },
  { type: "address", name: "buyToken" },
  { type: "address", name: "receiver" },
  { type: "uint256", name: "sellAmount" },
  { type: "uint256", name: "minBuyAmount" },
  { type: "uint256", name: "t0" },
  { type: "uint256", name: "t" },
  { type: "bytes32", name: "polymarketOrderHash" },
  { type: "bytes32", name: "appData" },
] as const;

const ORDER_DATA_TUPLE_V2 = [
  ...ORDER_DATA_TUPLE,
  { type: "uint256", name: "polymarketMakerAmount" },
] as const;

// All fields are static (32 bytes); V1 staticInput = 288 bytes, V2 = 320 (adds polymarketMakerAmount).
const V2_BYTE_LENGTH = ORDER_DATA_TUPLE_V2.length * 32;

/**
 * keccak256(abi.encode((handler, salt, staticInput))) — matches ComposableCoW.hash().
 * The result is the singleOrderHash key used for remove() and on-chain singleOrders[] reads.
 */
export function calculateOrderHash(params: ConditionalOrderParams): Hex {
  const encoded = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { type: "address", name: "handler" },
          { type: "bytes32", name: "salt" },
          { type: "bytes", name: "staticInput" },
        ],
      },
    ],
    [
      {
        handler: params.handler as `0x${string}`,
        salt: params.salt as `0x${string}`,
        staticInput: params.staticInput as `0x${string}`,
      },
    ]
  );
  return keccak256(encoded);
}

/**
 * Decode the staticInput bytes blob from a ConditionalOrderCreated event into
 * PolyswapOrderData. Field order MUST match the handler's struct layout.
 */
export function decodeStaticInput(staticInput: Hex): PolyswapOrderData {
  const byteLength = (staticInput.length - 2) / 2;
  if (byteLength >= V2_BYTE_LENGTH) {
    const d = decodeAbiParameters(ORDER_DATA_TUPLE_V2, staticInput);
    return {
      sellToken: d[0],
      buyToken: d[1],
      receiver: d[2],
      sellAmount: d[3].toString(),
      minBuyAmount: d[4].toString(),
      t0: d[5].toString(),
      t: d[6].toString(),
      polymarketOrderHash: d[7],
      appData: d[8],
      polymarketMakerAmount: d[9].toString(),
    };
  }
  const d = decodeAbiParameters(ORDER_DATA_TUPLE, staticInput);
  return {
    sellToken: d[0],
    buyToken: d[1],
    receiver: d[2],
    sellAmount: d[3].toString(),
    minBuyAmount: d[4].toString(),
    t0: d[5].toString(),
    t: d[6].toString(),
    polymarketOrderHash: d[7],
    appData: d[8],
    polymarketMakerAmount: "",
  };
}

/**
 * Custom errors thrown by CoW conditional-order handlers from
 * `getTradeableOrderWithSignature`. Match the IConditionalOrder interface
 * exposed by the upstream CoW contracts.
 */
const COW_CONDITIONAL_ORDER_ERROR_ABI = [
  { type: "error", name: "OrderNotValid", inputs: [{ name: "reason", type: "string" }] },
  { type: "error", name: "PollNever", inputs: [{ name: "reason", type: "string" }] },
  { type: "error", name: "PollTryNextBlock", inputs: [{ name: "reason", type: "string" }] },
  {
    type: "error",
    name: "PollTryAtBlock",
    inputs: [
      { name: "blockNumber", type: "uint256" },
      { name: "reason", type: "string" },
    ],
  },
  {
    type: "error",
    name: "PollTryAtEpoch",
    inputs: [
      { name: "timestamp", type: "uint256" },
      { name: "reason", type: "string" },
    ],
  },
] as const;

export type CowConditionalErrorName =
  | "OrderNotValid"
  | "PollNever"
  | "PollTryNextBlock"
  | "PollTryAtBlock"
  | "PollTryAtEpoch";

interface DecodedPollError {
  name: CowConditionalErrorName;
  reason: string;
  /**
   * For `PollTryAtBlock`: the block number to retry at.
   * For `PollTryAtEpoch`: the unix epoch seconds to retry at.
   * Undefined for terminal / next-block variants.
   */
  retryAt?: number;
}

/**
 * Decode the revert returndata from a `getTradeableOrderWithSignature` call.
 * Returns null when the bytes don't match any known CoW conditional-order error
 * (e.g. a generic Solidity revert, or some other unknown selector).
 */
export function decodePollError(returndata: Hex): DecodedPollError | null {
  try {
    const decoded = decodeErrorResult({
      abi: COW_CONDITIONAL_ORDER_ERROR_ABI,
      data: returndata,
    });
    const args = decoded.args ?? [];
    if (decoded.errorName === "PollTryAtBlock" || decoded.errorName === "PollTryAtEpoch") {
      const retryAt = args[0];
      const reason = args[1];
      if (typeof retryAt !== "bigint" || typeof reason !== "string") return null;
      return { name: decoded.errorName, reason, retryAt: Number(retryAt) };
    }
    // OrderNotValid / PollNever / PollTryNextBlock — single string arg
    const reason = args[0];
    if (typeof reason !== "string") return null;
    return { name: decoded.errorName as CowConditionalErrorName, reason };
  } catch {
    return null;
  }
}
