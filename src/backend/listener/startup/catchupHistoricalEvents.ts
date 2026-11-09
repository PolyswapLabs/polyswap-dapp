import { getAbiItem, type AbiEvent, type Log } from "viem";
import { getPublicClient } from "@/backend/rpc/clients";
import { handleConditionalOrderCreated } from "@/backend/listener/handlers/conditionalOrderCreated";
import { handleTrade } from "@/backend/listener/handlers/trade";
import { handleOrderInvalidated } from "@/backend/listener/handlers/orderInvalidated";
import { DatabaseService } from "@/backend/services/databaseService";
import composableCowAbi from "@/abi/composableCoW.json";
import gpv2Abi from "@/abi/GPV2Settlement.json";
import { createLogger } from "@/backend/logger";
import { requireAddress } from "@/backend/utils/env";

const log = createLogger("catchup");

const DEFAULT_BATCH_SIZE = 5_000n;

/**
 * Catch up on missed events between the last processed block and the chain head,
 * then advance the cursor. Idempotent — handlers are upsert-safe.
 *
 * Iterates in BATCH_SIZE windows so that an RPC log limit doesn't blow up the
 * whole catch-up. Honours STARTING_BLOCK as a floor.
 */
export async function catchupHistoricalEvents(
  options: { allowTrading?: boolean } = {}
): Promise<void> {
  const composableCow = requireAddress("COMPOSABLE_COW");
  const gpv2 = requireAddress("GPV2SETTLEMENT");
  const startingBlock = BigInt(process.env.STARTING_BLOCK ?? "0");
  const batchSize = BigInt(process.env.BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE));

  const client = getPublicClient();

  const dbCursor = BigInt(await DatabaseService.getLatestProcessedBlock());
  const head = await client.getBlockNumber();

  const fromBlock = dbCursor > startingBlock ? dbCursor + 1n : startingBlock;
  if (fromBlock > head) {
    log.debug(`up to date at block ${head}`);
    return;
  }
  log.info(`replaying blocks ${fromBlock}..${head} in batches of ${batchSize}`);

  const createdEvent = getAbiItem({
    abi: composableCowAbi,
    name: "ConditionalOrderCreated",
  }) as AbiEvent;
  const tradeEvent = getAbiItem({ abi: gpv2Abi, name: "Trade" }) as AbiEvent;
  const invalidatedEvent = getAbiItem({ abi: gpv2Abi, name: "OrderInvalidated" }) as AbiEvent;

  for (let cursor = fromBlock; cursor <= head; cursor += batchSize) {
    const windowEnd = cursor + batchSize - 1n > head ? head : cursor + batchSize - 1n;

    const [createdLogs, tradeLogs, invalidatedLogs] = await Promise.all([
      client.getLogs({
        address: composableCow,
        event: createdEvent,
        fromBlock: cursor,
        toBlock: windowEnd,
      }),
      client.getLogs({
        address: gpv2,
        event: tradeEvent,
        fromBlock: cursor,
        toBlock: windowEnd,
      }),
      client.getLogs({
        address: gpv2,
        event: invalidatedEvent,
        fromBlock: cursor,
        toBlock: windowEnd,
      }),
    ]);

    if (createdLogs.length || tradeLogs.length || invalidatedLogs.length) {
      log.debug(
        `blocks ${cursor}..${windowEnd}: created=${createdLogs.length} trades=${tradeLogs.length} invalidated=${invalidatedLogs.length}`
      );
    }

    for (const entry of createdLogs) {
      await handleConditionalOrderCreated(entry as Log, options);
    }
    for (const entry of tradeLogs) await handleTrade(entry as Log);
    for (const entry of invalidatedLogs) await handleOrderInvalidated(entry as Log);

    await DatabaseService.setLatestProcessedBlock(Number(windowEnd));
  }
  log.info(`catch-up complete; cursor at block ${head}`);
}
