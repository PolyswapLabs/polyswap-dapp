import { PolymarketPositionSellerService } from "@/backend/services/polymarketPositionSellerService";

/**
 * Start the periodic Polymarket position-sell sweep.
 */
export async function startPositionSeller(intervalMinutes = 5): Promise<void> {
  await PolymarketPositionSellerService.startSellRoutine(intervalMinutes);
}

export function stopPositionSeller(): void {
  PolymarketPositionSellerService.stopSellRoutine();
}

/**
 * Trigger an immediate sell pass — invoked by the Trade handler when an order
 * fills, so the position is offloaded promptly without waiting for the cron.
 */
export async function triggerPositionSell(): Promise<void> {
  await PolymarketPositionSellerService.triggerSell();
}
