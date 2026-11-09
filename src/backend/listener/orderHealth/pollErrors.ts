import { decodeErrorResult, type Hex } from "viem";

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
