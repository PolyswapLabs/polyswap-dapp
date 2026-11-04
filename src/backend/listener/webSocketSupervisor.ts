import type { PublicClient } from "viem";
import { createLogger } from "@/backend/logger";

const log = createLogger("ws-supervisor");

const CHECK_INTERVAL_MS = 30_000;
/** Connecting can wait on the OS for minutes, outside viem's own request timeout. */
const CHECK_TIMEOUT_MS = 10_000;
/** A provider that closes each new socket waits for the next check, not a tight loop. */
const MIN_REBUILD_GAP_MS = 10_000;

export interface WebSocketSupervisorOptions {
  connect: () => PublicClient;
  disconnect: () => void;
  subscribe: (ws: PublicClient, onError: (error: Error) => void) => Array<() => void>;
  /** Handles whatever happened while the subscriptions were down. */
  recover: () => Promise<void>;
}

let stop: (() => void) | null = null;

/** viem puts the provider URL in `message`, and that URL can contain an API key. */
function describe(error: unknown): string {
  const { shortMessage, message } = error as { shortMessage?: unknown; message?: unknown };
  if (typeof shortMessage === "string") return shortMessage;
  return typeof message === "string" && message ? message.split("\n", 1)[0]! : "unknown error";
}

async function isAlive(ws: PublicClient): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      ws.getBlockNumber({ cacheTime: 0 }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("check timed out")), CHECK_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Owns the WebSocket: it subscribes, and rebuilds the socket and subscriptions when
 * they are lost, without touching the rest of the process. viem's own reconnect stays
 * off because it can stop silently after an outage and does not replay missed events.
 */
export function startWebSocketSupervisor(options: WebSocketSupervisorOptions): void {
  if (stop) return;
  const { connect, disconnect, subscribe, recover } = options;

  let ws = connect();
  let unwatchers: Array<() => void> = [];
  let generation = 0;
  let down = false;
  let recoveryPending = false;
  let busy = false;
  let lastRebuildAt = Number.NEGATIVE_INFINITY;

  function watch(): void {
    const current = ++generation;
    unwatchers = subscribe(ws, (error) => {
      if (current !== generation || down) return;
      log.warn(`subscription lost: ${describe(error)}`);
      down = true;
      if (Date.now() - lastRebuildAt >= MIN_REBUILD_GAP_MS) void check();
    });
  }

  function unwatchAll(): void {
    generation++;
    for (const unwatch of unwatchers) {
      try {
        unwatch();
      } catch (error) {
        log.debug(`unsubscribe failed on the old socket: ${describe(error)}`);
      }
    }
    unwatchers = [];
  }

  async function rebuild(): Promise<void> {
    lastRebuildAt = Date.now();
    unwatchAll();
    disconnect();
    ws = connect();
    if (!(await isAlive(ws))) {
      down = true;
      log.warn("provider still unreachable; retrying on the next check");
      return;
    }
    if (stop === null) return;
    down = false;
    // Subscribe before catching up so nothing falls between the two. Handlers are
    // safe to run twice for one event: inserts are upserts and activation is claimed.
    watch();
    recoveryPending = true;
    log.info("subscriptions restored");
  }

  async function check(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (down || !(await isAlive(ws))) await rebuild();
      if (recoveryPending && !down && stop !== null) {
        await recover();
        recoveryPending = false;
      }
    } catch (error) {
      log.warn(`recovery failed; retrying on the next check: ${describe(error)}`);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
  stop = () => {
    clearInterval(timer);
    stop = null;
    unwatchAll();
    disconnect();
  };
  watch();
}

export function stopWebSocketSupervisor(): void {
  stop?.();
}
