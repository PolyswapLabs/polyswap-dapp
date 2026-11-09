import { createLogger } from "@/backend/logger";
import { MarketSyncService } from "@/backend/services/marketSyncService";

const log = createLogger("market-sync");

let updateInterval: NodeJS.Timeout | null = null;

/** Start the periodic Polymarket-to-DB market sync. Syncs immediately, then on every interval. */
export function startMarketSync(intervalMinutes = 60): void {
  if (updateInterval) return;

  log.debug(`routine started (${intervalMinutes} min interval)`);
  void MarketSyncService.updateMarkets();
  updateInterval = setInterval(
    () => void MarketSyncService.updateMarkets(),
    intervalMinutes * 60_000
  );
}

export function stopMarketSync(): void {
  if (!updateInterval) return;

  clearInterval(updateInterval);
  updateInterval = null;
  log.debug("routine stopped");
}
