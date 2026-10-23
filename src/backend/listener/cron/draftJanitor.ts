import { type Address, type Hex } from "viem";
import { getPublicClient } from "../blockchainProvider";
import { DatabaseService } from "@/backend/services/databaseService";
import composableCowAbi from "@/abi/composableCoW.json";
import { createLogger } from "@/backend/logger";

const log = createLogger("draft-janitor");

const STALE_AFTER_MS = 10 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

function requireComposableCow(): Address {
  const v = process.env.COMPOSABLE_COW;
  if (!v) throw new Error("COMPOSABLE_COW is not set");
  return v as Address;
}

/**
 * Sweep stale draft orders: those still in `draft` status more than
 * STALE_AFTER_MS after creation. Shared sentinels are never canceled here:
 * an unconfirmed draft cannot have activated one, while another confirmed
 * order may still reference the same sentinel.
 */
export async function sweepStaleDrafts(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await DatabaseService.findDraftsOlderThan(cutoff);
  if (stale.length === 0) {
    log.debug("no stale drafts");
    return;
  }
  log.debug(`found ${stale.length} stale draft(s) older than ${STALE_AFTER_MS / 60_000}min`);

  const client = getPublicClient();
  const composableCow = requireComposableCow();
  for (const draft of stale) {
    try {
      // If a draft already has an order_hash and is authed on-chain, leave
      // it alone — the listener will transition it to `live`. This protects
      // catch-up race windows where the row's status hasn't caught up yet.
      if (draft.order_hash) {
        const exists = await client.readContract({
          address: composableCow,
          abi: composableCowAbi,
          functionName: "singleOrders",
          args: [draft.owner as Address, draft.order_hash as Hex],
        });
        if (exists === true) continue;
      }

      await DatabaseService.deletePolyswapOrderById(draft.id);
      log.info(`swept draft ${draft.id} (owner ${draft.owner})`);
    } catch (err) {
      log.warn(`failed for order ${draft.id}:`, err);
    }
  }
}

async function runScheduledSweep(): Promise<void> {
  if (isRunning) {
    log.warn("previous sweep is still running; skipping this tick");
    return;
  }

  isRunning = true;
  try {
    await sweepStaleDrafts();
  } catch (err) {
    log.error("sweep failed; will retry on the next tick", err);
  } finally {
    isRunning = false;
  }
}

export function startDraftJanitor(intervalSeconds = 60): void {
  if (timer) return;
  timer = setInterval(() => void runScheduledSweep(), intervalSeconds * 1000);
  log.debug(`sweep every ${intervalSeconds}s, stale > ${STALE_AFTER_MS / 60_000}min`);
}

export function stopDraftJanitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
