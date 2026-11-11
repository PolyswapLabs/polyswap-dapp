import { createLogger } from "@/backend/logger";

/** A recurring job that skips a tick while a run is in progress and survives failed runs. */
export function createIntervalJob(name: string, run: () => Promise<void>) {
  const log = createLogger(name);
  let timer: NodeJS.Timeout | null = null;
  let isRunning = false;

  async function runOnce(): Promise<void> {
    if (isRunning) {
      log.warn("previous run is still in progress; skipping this tick");
      return;
    }
    isRunning = true;
    try {
      await run();
    } catch (err) {
      log.error("run failed; will retry on the next tick", err);
    } finally {
      isRunning = false;
    }
  }

  return {
    start(intervalMs: number): void {
      if (timer) return;
      timer = setInterval(() => void runOnce(), intervalMs);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
