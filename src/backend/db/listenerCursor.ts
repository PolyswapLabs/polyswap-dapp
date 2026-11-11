import { prisma } from "./prisma";

export const listenerCursor = {
  /**
   * Persisted cursor lives in `listener_state.last_processed_block`. Fall back
   * to MAX(block_number) on first run / pre-cursor environments.
   */
  async getLatestProcessedBlock(): Promise<number> {
    const state = await prisma.listenerState.findUnique({
      where: { key: "last_processed_block" },
    });
    if (state) return Number(state.value);

    const fallback = await prisma.polyswapOrder.aggregate({ _max: { blockNumber: true } });
    return Number(fallback._max.blockNumber ?? 0);
  },

  async setLatestProcessedBlock(blockNumber: number): Promise<void> {
    await prisma.listenerState.upsert({
      where: { key: "last_processed_block" },
      create: { key: "last_processed_block", value: BigInt(blockNumber) },
      update: { value: BigInt(blockNumber), updatedAt: new Date() },
    });
  },
};
