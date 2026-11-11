import { encodeFunctionData, type Hex } from "viem";
import composableCowAbi from "@/abi/composableCoW.json";
import type { PublicPolyswapOrder } from "@/backend/interfaces/PolyswapOrder";
import type { SafeCall } from "@/client/safe/types";
import { COMPOSABLE_COW } from "@/shared/contracts";

export type CancelOrderState = Pick<PublicPolyswapOrder, "status" | "order_hash">;

export type CancelOutcome =
  /** The order is live: the Safe must call ComposableCoW.remove(orderHash). */
  | { kind: "remove_on_chain"; orderHash: Hex }
  /** Its Safe transaction is not confirmed yet (still a draft, or no hash recorded). */
  | { kind: "confirming" }
  /** Already filled, cancelled, expired or errored: nothing to cancel. */
  | { kind: "final"; status: PublicPolyswapOrder["status"] }
  /** The server no longer has the order, e.g. a draft swept after 10 minutes. */
  | { kind: "gone" };

/**
 * Decides how to cancel from the server's current state, not the page's cached
 * copy. Only a confirmed live order can be cancelled: deleting a draft would not
 * stop a Safe transaction that is already signed or queued.
 */
export function planCancel(order: CancelOrderState | null): CancelOutcome {
  if (!order) return { kind: "gone" };
  if (order.status === "draft") return { kind: "confirming" };
  if (order.status !== "live") return { kind: "final", status: order.status };
  return order.order_hash
    ? { kind: "remove_on_chain", orderHash: order.order_hash as Hex }
    : { kind: "confirming" };
}

/** The Safe call that removes a live order: `ComposableCoW.remove(orderHash)`. */
export function removeOrderCalls(orderHash: Hex): SafeCall[] {
  const data = encodeFunctionData({
    abi: composableCowAbi,
    functionName: "remove",
    args: [orderHash],
  });
  return [{ to: COMPOSABLE_COW, data, value: 0n }];
}
