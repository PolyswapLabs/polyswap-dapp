import type { Log, PublicClient } from "viem";
import {
  subscribePositionReceipts,
  triggerPositionSell,
} from "@/backend/listener/cron/positionSeller";
import {
  CONDITIONAL_ORDER_CREATED_EVENT,
  ORDER_INVALIDATED_EVENT,
  TRADE_EVENT,
  type EventHandlingOptions,
} from "@/backend/listener/events";
import { handleConditionalOrderCreated } from "@/backend/listener/handlers/conditionalOrderCreated";
import { handleLiveOrderInvalidated } from "@/backend/listener/handlers/orderInvalidated";
import { handleLiveTrade } from "@/backend/listener/handlers/trade";
import { catchupHistoricalEvents } from "@/backend/listener/startup/catchupHistoricalEvents";
import { startWebSocketSupervisor } from "@/backend/listener/webSocketSupervisor";
import { closeWebSocketClient, getWebSocketClient } from "@/backend/rpc/clients";
import { requireAddress } from "@/backend/utils/env";

function subscribeOrderEvents(
  ws: PublicClient,
  options: EventHandlingOptions,
  onError: (error: Error) => void
): Array<() => void> {
  const composableCow = requireAddress("COMPOSABLE_COW");
  const gpv2 = requireAddress("GPV2SETTLEMENT");

  return [
    ws.watchEvent({
      address: composableCow,
      event: CONDITIONAL_ORDER_CREATED_EVENT,
      onError,
      onLogs: (logs) => {
        for (const log of logs) {
          void handleConditionalOrderCreated(log as Log, options);
        }
      },
    }),
    ws.watchEvent({
      address: gpv2,
      event: TRADE_EVENT,
      onError,
      onLogs: (logs) => {
        for (const log of logs) {
          void handleLiveTrade(log as Log, triggerPositionSell);
        }
      },
    }),
    ws.watchEvent({
      address: gpv2,
      event: ORDER_INVALIDATED_EVENT,
      onError,
      onLogs: (logs) => {
        for (const log of logs) {
          void handleLiveOrderInvalidated(log as Log);
        }
      },
    }),
  ];
}

export function startEventSubscriptions(options: EventHandlingOptions): void {
  const trading = options.allowTrading === true;
  startWebSocketSupervisor({
    connect: getWebSocketClient,
    disconnect: closeWebSocketClient,
    subscribe: (ws, onError) => [
      ...subscribeOrderEvents(ws, options, onError),
      ...(trading ? subscribePositionReceipts(ws, onError) : []),
    ],
    recover: async () => {
      if (trading) void triggerPositionSell();
      await catchupHistoricalEvents(options);
    },
  });
}
