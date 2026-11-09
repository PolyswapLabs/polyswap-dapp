import type { Address, Hex } from "viem";
import composableCowAbi from "@/abi/composableCoW.json";
import type { ConditionalOrderParams } from "@/backend/interfaces/PolyswapOrder";
import { getPublicClient } from "@/backend/rpc/clients";
import { COMPOSABLE_COW } from "@/lib/contracts";

/**
 * Reads `singleOrders[owner][hash]`: true after create, false after remove.
 * Null when the node answers with anything but a bool.
 */
export async function isSingleOrderAuthed(owner: Address, hash: Hex): Promise<boolean | null> {
  const authed = await getPublicClient().readContract({
    address: COMPOSABLE_COW,
    abi: composableCowAbi,
    functionName: "singleOrders",
    args: [owner, hash],
  });
  return typeof authed === "boolean" ? authed : null;
}

/** Resolves when the order can trade now; otherwise rejects with the handler's revert. */
export async function assertOrderTradeable(
  owner: Address,
  params: ConditionalOrderParams
): Promise<void> {
  await getPublicClient().readContract({
    address: COMPOSABLE_COW,
    abi: composableCowAbi,
    functionName: "getTradeableOrderWithSignature",
    args: [owner, params, "0x", []],
  });
}
