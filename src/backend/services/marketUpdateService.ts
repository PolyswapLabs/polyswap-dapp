import { PolymarketAPIService } from "./polymarketAPIService.js";
import { DatabaseService } from "./databaseService.js";
import { diffMarkets } from "./marketSyncDiff.js";
import { createLogger } from "../logger.js";
import { readPositiveInt } from "@/backend/utils/env";
import type { Market } from "../interfaces/Market";

const log = createLogger("market-sync");

const COMPARE_BATCH_SIZE = 1000;

interface MarketUpdateStats {
  fetched: number;
  upserted: number;
  unchanged: number;
  removed: number;
  tagsIndexed: number;
}

type MarketSyncResult =
  | { status: "completed"; stats: MarketUpdateStats }
  | { status: "already_running" }
  | { status: "failed" };

export class MarketUpdateService {
  private static isUpdating = false;

  /**
   * Fetch all active Polymarket markets from Gamma and upsert the ones that
   * differ from the lean search-index table. Then remove any markets whose
   * end_date has passed.
   */
  static async updateMarkets(): Promise<MarketSyncResult> {
    if (this.isUpdating) return { status: "already_running" };

    this.isUpdating = true;
    const startedAt = Date.now();
    try {
      log.info("starting market sync");
      const markets = await this.fetchOpenMarkets();
      const upserted = await this.upsertChangedMarkets(markets);
      const { removed, tagsIndexed, reindexed } = await this.runIndexMaintenance();

      const stats: MarketUpdateStats = {
        fetched: markets.length,
        upserted,
        unchanged: markets.length - upserted,
        removed,
        tagsIndexed,
      };
      log.info(
        `sync complete in ${Date.now() - startedAt}ms ` +
          `(upserted=${stats.upserted}, unchanged=${stats.unchanged}, removed=${stats.removed}, tags=${stats.tagsIndexed}, reindexed=${reindexed})`
      );
      return { status: "completed", stats };
    } catch (error) {
      log.error("update failed:", error);
      return { status: "failed" };
    } finally {
      this.isUpdating = false;
    }
  }

  private static async fetchOpenMarkets(): Promise<Market[]> {
    log.debug("requesting open markets from Polymarket Gamma");
    const fetchStart = Date.now();
    const markets = await PolymarketAPIService.getOpenMarkets({
      endDateMin: new Date().toISOString(),
    });
    log.info(`fetched ${markets.length} markets from Gamma in ${Date.now() - fetchStart}ms`);
    return markets;
  }

  /** Returns how many markets differed from their stored row and were written. */
  private static async upsertChangedMarkets(markets: Market[]): Promise<number> {
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
    log.info(
      `upserted ${upserted} changed markets, skipped ${markets.length - upserted} unchanged in ${Date.now() - upsertStart}ms`
    );
    return upserted;
  }

  private static async runIndexMaintenance(): Promise<{
    removed: number;
    tagsIndexed: number;
    reindexed: number;
  }> {
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
    log.info(`search-vec refreshed: ${reindexed} rows reindexed in ${Date.now() - searchStart}ms`);

    return { removed, tagsIndexed, reindexed };
  }
}
