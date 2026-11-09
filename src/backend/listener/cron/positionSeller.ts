import type { PublicClient } from "viem";
import {
  TRANSFER_BATCH,
  TRANSFER_SINGLE,
  getPositionLedgers,
} from "@/backend/polymarket/inventory";
import { PolymarketPositionSellerService } from "@/backend/services/polymarketPositionSellerService";

/**
 * The first pass can see too little: the RPC or the CLOB's balance index may lag the
 * event, and a failed sale would otherwise wait for the cron.
 */
const FOLLOW_UP_DELAY_MS = 30_000;

let sellInterval: NodeJS.Timeout | null = null;
let followUp: NodeJS.Timeout | null = null;

function clearFollowUp(): void {
  if (followUp) clearTimeout(followUp);
  followUp = null;
}

function sellAfterReceipt(): void {
  void triggerPositionSell();
  clearFollowUp();
  followUp = setTimeout(() => void triggerPositionSell(), FOLLOW_UP_DELAY_MS);
}

/** Start the backup sell cron. Sells immediately, then on every interval. */
export async function startPositionSeller(intervalMinutes: number): Promise<void> {
  if (sellInterval) return;
  PolymarketPositionSellerService.initialize();
  void triggerPositionSell();
  sellInterval = setInterval(() => void triggerPositionSell(), intervalMinutes * 60_000);
}

/** Sell as soon as shares reach the operator wallet. Call after startPositionSeller. */
export function subscribePositionReceipts(
  ws: PublicClient,
  onError: (error: Error) => void
): Array<() => void> {
  const owner = PolymarketPositionSellerService.getOwnerAddress();
  if (!owner) throw new Error("Position seller has no owner address");

  const address = getPositionLedgers();
  return [
    ws.watchEvent({
      address,
      event: TRANSFER_SINGLE,
      args: { to: owner },
      onLogs: sellAfterReceipt,
      onError,
    }),
    ws.watchEvent({
      address,
      event: TRANSFER_BATCH,
      args: { to: owner },
      onLogs: sellAfterReceipt,
      onError,
    }),
  ];
}

export function stopPositionSeller(): void {
  if (sellInterval) clearInterval(sellInterval);
  sellInterval = null;
  clearFollowUp();
}

/**
 * Trigger an immediate sell pass, for a fill seen on the ledger or on CoW.
 */
export async function triggerPositionSell(): Promise<void> {
  await PolymarketPositionSellerService.sellPositions();
}
