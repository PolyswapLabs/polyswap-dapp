import { PolymarketAPIService } from "./polymarketAPIService.js";
import { DatabaseService } from "./databaseService.js";
import { diffMarkets } from "./marketSyncDiff.js";
import { createLogger } from "../logger.js";
import { readPositiveInt } from "@/backend/utils/env";

const log = createLogger("market-sync");

const COMPARE_BATCH_SIZE = 1000;

interface MarketUpdateStats {
  fetched: number;
  upserted: number;
  unchanged: number;
  removed: number;
  tagsIndexed: number;
}

export class MarketUpdateService {
  private static updateInterval: NodeJS.Timeout | null = null;
  private static isUpdating = false;

  /**
   * Start the market update routine with the given interval.
   * Fires immediately on start, then on each subsequent interval.
   */
  static startUpdateRoutine(intervalMinutes: number = 60) {
    if (this.updateInterval) return;

    const intervalMs = intervalMinutes * 60 * 1000;
    log.debug(`routine started (${intervalMinutes} min interval)`);

    void this.updateMarkets();
    this.updateInterval = setInterval(() => {
      void this.updateMarkets();
    }, intervalMs);
  }

  /**
   * Stop the market update routine.
   */
  static stopUpdateRoutine() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      log.debug("routine stopped");
    }
  }

  /**
   * Fetch all active Polymarket markets from Gamma and upsert the ones that
   * differ from the lean search-index table. Then remove any markets whose
   * end_date has passed.
   */
  static async updateMarkets(): Promise<MarketUpdateStats | null> {
    if (this.isUpdating) return null;

    this.isUpdating = true;
    const startedAt = Date.now();
    try {
      log.info("starting market sync");

      log.debug("requesting open markets from Polymarket Gamma");
      const fetchStart = Date.now();
      const markets = await PolymarketAPIService.getOpenMarkets({
        endDateMin: new Date().toISOString(),
      });
      log.info(`fetched ${markets.length} markets from Gamma in ${Date.now() - fetchStart}ms`);

      const concurrency = readPositiveInt("MARKET_UPSERT_CONCURRENCY", 25);
      log.info(`comparing ${markets.length} markets with DB (concurrency=${concurrency})`);
      const upsertStart = Date.now();
      let done = 0;
      let upserted = 0;
      for (let i = 0; i < markets.length; i += COMPARE_BATCH_SIZE) {
        const batch = markets.slice(i, i + COMPARE_BATCH_SIZE);
        const existing = await DatabaseService.getMarketsForSync(batch.map((m) => m.id));
        const { changed, searchStale } = diffMarkets(batch, existing);
        await DatabaseService.invalidateSearchVectors(searchStale);
        for (let j = 0; j < changed.length; j += concurrency) {
          const chunk = changed.slice(j, j + concurrency);
          await Promise.all(chunk.map((m) => DatabaseService.upsertMarket(m)));
        }
        upserted += changed.length;
        done += batch.length;
        const elapsedMs = Date.now() - upsertStart;
        const rate = (done / (elapsedMs / 1000)).toFixed(1);
        const etaMs = ((markets.length - done) / Math.max(done, 1)) * elapsedMs;
        log.debug(
          `sync progress ${done}/${markets.length}, ${upserted} changed ` +
            `(${rate}/s, eta ${Math.round(etaMs / 1000)}s)`
        );
      }
      const unchanged = markets.length - upserted;
      log.info(
        `upserted ${upserted} changed markets, skipped ${unchanged} unchanged in ${Date.now() - upsertStart}ms`
      );

      log.debug("removing ended markets");
      const removed = await DatabaseService.removeEndedMarkets();
      log.info(`removed ${removed} ended markets`);

      log.debug("refreshing tag index");
      const tagStart = Date.now();
      const tagsIndexed = await DatabaseService.refreshTagIndex();
      log.info(`tag-index refreshed: ${tagsIndexed} unique tags in ${Date.now() - tagStart}ms`);

      log.debug("refreshing search vectors");
      const searchStart = Date.now();
      const reindexed = await DatabaseService.refreshMissingSearchVectors();
      log.info(
        `search-vec refreshed: ${reindexed} rows reindexed in ${Date.now() - searchStart}ms`
      );

      const stats: MarketUpdateStats = {
        fetched: markets.length,
        upserted,
        unchanged,
        removed,
        tagsIndexed,
      };
      log.info(
        `sync complete in ${Date.now() - startedAt}ms ` +
          `(upserted=${stats.upserted}, unchanged=${stats.unchanged}, removed=${stats.removed}, tags=${stats.tagsIndexed}, reindexed=${reindexed})`
      );
      return stats;
    } catch (error) {
      log.error("update failed:", error);
      return null;
    } finally {
      this.isUpdating = false;
    }
  }
}
