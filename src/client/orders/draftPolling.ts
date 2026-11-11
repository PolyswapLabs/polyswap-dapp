import type { PublicPolyswapOrder } from "@/backend/interfaces/PolyswapOrder";

export const DRAFT_POLL_MS = 4_000;

/**
 * Refetch interval for the orders query. A draft turns live a few seconds after
 * its Safe transaction, so poll while one exists; the listener sweeps drafts
 * after 10 minutes, so the polling always stops.
 */
export function ordersRefetchInterval(
  orders: Pick<PublicPolyswapOrder, "status">[] | undefined
): number | false {
  return orders?.some((o) => o.status === "draft") ? DRAFT_POLL_MS : false;
}
