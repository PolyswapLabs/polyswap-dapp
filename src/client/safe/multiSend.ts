import { concatHex, encodeFunctionData, numberToHex, size, type Address, type Hex } from "viem";
import type { SafeCall } from "./types";

/**
 * Polygon `MultiSendCallOnly` — the variant that disallows DELEGATECALL inside
 * the batch (each sub-call is a normal CALL).
 *
 * Source: https://github.com/safe-global/safe-deployments
 */
const MULTI_SEND_CALL_ONLY: Address = "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D";

const MULTI_SEND_ABI = [
  {
    inputs: [{ name: "transactions", type: "bytes" }],
    name: "multiSend",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;

/**
 * Packs a list of calls into the MultiSend wire format:
 *   for each call: operation(1) | to(20) | value(32) | dataLen(32) | data(dataLen)
 * Then ABI-encodes a single `multiSend(bytes)` call to MultiSendCallOnly.
 *
 * Operation is forced to 0 (CALL); MultiSendCallOnly rejects DELEGATECALL.
 *
 * The outer `value` returned is the sum of all sub-call values, since
 * MultiSendCallOnly forwards the outer value to each sub-call per the
 * packed `value` field. Throws if `calls` is empty.
 */
export function encodeMultiSend(calls: SafeCall[]): { to: Address; data: Hex; value: bigint } {
  if (calls.length === 0) throw new Error("encodeMultiSend: calls must not be empty");

  const packed = concatHex(
    calls.map((c) => {
      const data = (c.data ?? "0x") as Hex;
      const dataLen = size(data);
      return concatHex([
        "0x00", // operation = CALL
        c.to,
        numberToHex(c.value ?? 0n, { size: 32 }),
        numberToHex(BigInt(dataLen), { size: 32 }),
        data,
      ]);
    })
  );

  const totalValue = calls.reduce((acc, c) => acc + (c.value ?? 0n), 0n);
  return {
    to: MULTI_SEND_CALL_ONLY,
    data: encodeFunctionData({
      abi: MULTI_SEND_ABI,
      functionName: "multiSend",
      args: [packed],
    }),
    value: totalValue,
  };
}
