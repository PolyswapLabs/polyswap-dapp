import type { Intervals, Mode } from "@/backend/listener/config";
import { startDraftJanitor, stopDraftJanitor } from "@/backend/listener/cron/draftJanitor";
import { startMarketSync, stopMarketSync } from "@/backend/listener/cron/marketSync";
import {
  startOrderHealthCheck,
  stopOrderHealthCheck,
} from "@/backend/listener/cron/orderHealthCheck";
import { startPositionSeller, stopPositionSeller } from "@/backend/listener/cron/positionSeller";
import type { EventHandlingOptions } from "@/backend/listener/events";
import { startEventSubscriptions } from "@/backend/listener/subscriptions";
import { stopWebSocketSupervisor } from "@/backend/listener/webSocketSupervisor";
import { createLogger } from "@/backend/logger";

const log = createLogger("listener");

export interface Service {
  start: () => void | Promise<void>;
  stop: () => void;
}

function cron(
  name: string,
  interval: number,
  unit: "min" | "s",
  start: (interval: number) => void | Promise<void>,
  stop: () => void
): Service {
  return {
    start: () => {
      log.info(`starting ${name} cron every ${interval}${unit}`);
      return start(interval);
    },
    stop,
  };
}

/** In start order; a position seller must exist before subscriptions watch its receipts. */
export function buildServices(
  mode: Mode,
  intervals: Intervals,
  eventOptions: EventHandlingOptions
): Service[] {
  const { positionSellMinutes, draftJanitorSeconds, orderHealthCheckSeconds } = intervals;
  const tradingCrons = [
    cron("position-seller", positionSellMinutes, "min", startPositionSeller, stopPositionSeller),
    cron("draft-janitor", draftJanitorSeconds, "s", startDraftJanitor, stopDraftJanitor),
    cron(
      "order-health-check",
      orderHealthCheckSeconds,
      "s",
      startOrderHealthCheck,
      stopOrderHealthCheck
    ),
  ];
  const eventSubscriptions: Service = {
    start: () => startEventSubscriptions(eventOptions),
    stop: stopWebSocketSupervisor,
  };
  const marketSync = cron(
    "market-sync",
    intervals.marketUpdateMinutes,
    "min",
    startMarketSync,
    stopMarketSync
  );

  return [
    ...(mode === "all" ? tradingCrons : []),
    ...(mode === "markets" ? [] : [eventSubscriptions]),
    ...(mode === "listener" ? [] : [marketSync]),
  ];
}
