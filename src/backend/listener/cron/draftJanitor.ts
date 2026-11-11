import { type Address, type Hex } from "viem";
import { isSingleOrderAuthed } from "@/backend/rpc/composableCow";
import { orderRepository } from "@/backend/db/orderRepository";
import { createLogger } from "@/backend/logger";
import { createIntervalJob } from "./intervalJob";

const log = createLogger("draft-janitor");

const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Sweep stale draft orders: those still in `draft` status more than
 * STALE_AFTER_MS after creation. Shared sentinels are never canceled here:
 * an unconfirmed draft cannot have activated one, while another confirmed
 * order may still reference the same sentinel.
 */
async function sweepStaleDrafts(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await orderRepository.findDraftsOlderThan(cutoff);
  if (stale.length === 0) {
    log.debug("no stale drafts");
    return;
  }
  log.debug(`found ${stale.length} stale draft(s) older than ${STALE_AFTER_MS / 60_000}min`);

  for (const draft of stale) {
    try {
      // If a draft already has an order_hash and is authed on-chain, leave
      // it alone — the listener will transition it to `live`. This protects
      // catch-up race windows where the row's status hasn't caught up yet.
      if (draft.order_hash) {
        const authed = await isSingleOrderAuthed(draft.owner as Address, draft.order_hash as Hex);
        if (authed === true) continue;
      }

      await orderRepository.deletePolyswapOrderById(draft.id);
      log.info(`swept draft ${draft.id} (owner ${draft.owner})`);
    } catch (err) {
      log.warn(`failed for order ${draft.id}:`, err);
    }
  }
}

const job = createIntervalJob("draft-janitor", sweepStaleDrafts);

export function startDraftJanitor(intervalSeconds = 60): void {
  job.start(intervalSeconds * 1000);
  log.debug(`sweep every ${intervalSeconds}s, stale > ${STALE_AFTER_MS / 60_000}min`);
}

export const stopDraftJanitor = job.stop;
