import type { Address, Hex } from "viem";
import type { Expiry, Slippage } from "@/hooks/useCreateOrder";
import type { SafeCall } from "@/services/safe/types";
import { DAY_MS } from "@/lib/time";

export const EXPIRY_OPTIONS: ReadonlyArray<{
  value: Expiry;
  label: string;
  recapLabel: string;
  days: number | null;
}> = [
  { value: "7d", label: "7 days", recapLabel: "in 7 days", days: 7 },
  { value: "30d", label: "30 days", recapLabel: "in 30 days", days: 30 },
  {
    value: "until-resolution",
    label: "Until market resolves",
    recapLabel: "when the market resolves",
    days: null,
  },
];

export function expiryRecapLabel(expiry: Expiry): string {
  return EXPIRY_OPTIONS.find((o) => o.value === expiry)?.recapLabel ?? "when the market resolves";
}

/** ISO deadline for a fixed duration; an order open until resolution sends none. */
export function deadlineFromExpiry(expiry: Expiry, now = Date.now()): string | undefined {
  const days = EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days;
  return days ? new Date(now + days * DAY_MS).toISOString() : undefined;
}

interface TransactionPayload {
  to: Address;
  data: Hex;
  value: string;
}

export function toSafeCall(tx: TransactionPayload): SafeCall {
  return {
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : 0n,
  };
}

/** Scales a positive amount using 6 dp of integer math to avoid floating-point drift. */
function scaleToUnits(amount: number, decimals: number): bigint {
  const factor = BigInt(10) ** BigInt(decimals);
  return (BigInt(Math.round(amount * 1e6)) * factor) / BigInt(1e6);
}

export function toWei(amount: string, decimals: number): string {
  const parsed = parseFloat(amount) || 0;
  if (parsed <= 0) return "0";
  return scaleToUnits(parsed, decimals).toString();
}

/**
 * Convert the user's slippage preference into a `minBuyAmount` (raw uint256
 * string) sent to the backend. "Auto" or missing estimates fall back to "1"
 * (1 wei) — a non-zero floor that the contract / CoW solver treats as "any
 * non-zero fill counts". A numeric percent applies `(1 - pct/100)` to the
 * current estimated buy amount.
 */
export function computeMinBuyAmount(
  slippage: Slippage,
  amountOutEstimate: number,
  buyDecimals: number
): string {
  if (slippage === "auto" || !Number.isFinite(amountOutEstimate) || amountOutEstimate <= 0) {
    return "1";
  }
  const floor = amountOutEstimate * (1 - slippage / 100);
  if (!(floor > 0)) return "1";
  const scaled = scaleToUnits(floor, buyDecimals);
  // Guard against zero from extreme rounding on tiny estimates.
  return scaled > 0n ? scaled.toString() : "1";
}

interface OrderTransactions {
  sellAmount: string;
  tx: TransactionPayload;
  batchTx: TransactionPayload[];
  fallbackSetupTx?: TransactionPayload | null;
}

/** The Safe batch for a new order, given the vault relayer's current allowance. */
export function buildSafeCalls(order: OrderTransactions, allowance: bigint): SafeCall[] {
  // Already approved for at least the sell amount: skip the approve step.
  const baseCalls =
    allowance >= BigInt(order.sellAmount) ? [toSafeCall(order.tx)] : order.batchTx.map(toSafeCall);

  // Fresh Safes ship with the default CompatibilityFallbackHandler, but CoW
  // needs ExtensibleFallbackHandler to read EIP-1271 sigs. The backend returns
  // this self-call only when the swap-out is required.
  return order.fallbackSetupTx ? [toSafeCall(order.fallbackSetupTx), ...baseCalls] : baseCalls;
}
