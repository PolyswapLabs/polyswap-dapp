import { parseProtocolVersion, parseStringArray } from "../src/lib/polymarket/protocol";
import { promises as fs } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { testConnection } from "../src/backend/db/database";
import { DatabaseService } from "../src/backend/services/databaseService";
import { type Market } from "../src/backend/interfaces/Market";
import { createLogger } from "../src/backend/logger.js";

const log = createLogger("import-json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SerializedMarket {
  id: string;
  slug?: string;
  eventSlug?: string | null;
  question?: string;
  description?: string | null;
  category?: string | null;
  tags?: string[];
  outcomes?: string[];
  volume?: number;
  liquidity?: number;
  endDate?: string | null;
  clobTokenIds?: string[];
  protocolVersion?: string;
  positionIds?: string[];
  conditionId?: string;
  active?: boolean;
  negRisk?: boolean;
}

function reviveMarket(raw: SerializedMarket): Market | null {
  if (!raw.id || !raw.slug || !raw.question) return null;

  return {
    id: raw.id,
    slug: raw.slug,
    eventSlug: raw.eventSlug ?? null,
    question: raw.question,
    description: raw.description ?? null,
    category: raw.category ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    outcomes: Array.isArray(raw.outcomes) ? raw.outcomes : [],
    volume: typeof raw.volume === "number" ? raw.volume : 0,
    liquidity: typeof raw.liquidity === "number" ? raw.liquidity : 0,
    endDate: raw.endDate ? new Date(raw.endDate) : null,
    clobTokenIds: parseStringArray(raw.clobTokenIds),
    protocolVersion: raw.protocolVersion ? parseProtocolVersion(raw.protocolVersion) : null,
    positionIds: parseStringArray(raw.positionIds),
    conditionId: raw.conditionId ?? null,
    active: raw.active ?? true,
    negRisk: raw.negRisk ?? false,
  };
}

/**
 * Load market data from data.json and upsert into the lean markets table.
 */
async function loadDataFromJson() {
  log.info("Starting data import from JSON file...");

  try {
    log.info("Testing database connection...");
    const isConnected = await testConnection();
    if (!isConnected) {
      log.error("Failed to connect to database");
      return;
    }
    log.info("Database connected successfully!");

    log.info("Reading data.json file...");
    const jsonPath = resolve(__dirname, "../data.json");
    const jsonData = await fs.readFile(jsonPath, "utf-8");
    const rawMarkets: SerializedMarket[] = JSON.parse(jsonData) as SerializedMarket[];

    log.info(`Found ${rawMarkets.length} markets in JSON file`);

    const batchSize = 1000;
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    const removed = await DatabaseService.removeEndedMarkets();

    log.info("Starting upsert (processing in batches)...");

    for (let i = 0; i < rawMarkets.length; i += batchSize) {
      const batch = rawMarkets.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(rawMarkets.length / batchSize);

      log.info(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} markets)...`);

      for (const raw of batch) {
        const lean = reviveMarket(raw);
        if (!lean) {
          skipCount++;
          continue;
        }
        try {
          await DatabaseService.upsertMarket(lean);
          successCount++;
        } catch (error) {
          errorCount++;
          log.error(
            `Error upserting market ${raw.id}:`,
            error instanceof Error ? error.message : error
          );
        }
      }

      if (i + batchSize < rawMarkets.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const tagCount = await DatabaseService.refreshTagIndex();

    log.info("\nImport completed!");
    log.info(
      `Results: ${successCount} upserted, ${skipCount} skipped, ${errorCount} errors, ${removed} ended markets removed, ${tagCount} tags indexed`
    );
  } catch (error) {
    log.error("Error during data import:", error);
    throw error;
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  loadDataFromJson()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { loadDataFromJson };
