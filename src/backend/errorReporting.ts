import { randomUUID } from "node:crypto";
import Sentry from "@sentry/nextjs";
import type { Log } from "viem";
import { createLogger } from "@/backend/logger";

const log = createLogger("conditional-order");

/** viem puts the provider URL in `message`, and that URL can contain an API key. */
export function describeError(error: unknown): string {
  const { shortMessage, message } = error as { shortMessage?: unknown; message?: unknown };
  if (typeof shortMessage === "string") return shortMessage;
  return typeof message === "string" && message ? message.split("\n", 1)[0]! : "unknown error";
}

function toReportableError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error).slice(0, 1_000));

  const shortMessage = (error as Error & { shortMessage?: unknown }).shortMessage;
  const message =
    typeof shortMessage === "string"
      ? shortMessage
      : (error.message.split("\n", 1)[0] ?? error.name);
  const reportable = new Error(message.slice(0, 1_000));
  reportable.name = error.name;

  // Viem decoding errors embed the complete invalid calldata in their message.
  // Keep useful stack frames without forwarding an attacker-controlled blob.
  const frames = error.stack?.split("\n").filter((line) => line.trimStart().startsWith("at "));
  if (frames?.length) {
    reportable.stack = `${reportable.name}: ${reportable.message}\n${frames.join("\n")}`;
  }

  return reportable;
}

export function reportSkippedOrder(error: unknown, eventLog: Log): void {
  const errorId = randomUUID();
  const normalizedError = toReportableError(error);
  const eventContext = {
    errorId,
    errorType: normalizedError.name,
    transactionHash: eventLog.transactionHash ?? "unknown",
    blockNumber: eventLog.blockNumber?.toString() ?? "unknown",
    logIndex: eventLog.logIndex?.toString() ?? "unknown",
  };

  let sentryEventId: string | undefined;
  try {
    Sentry.withScope((scope) => {
      scope.setLevel("error");
      scope.setTag("error_id", errorId);
      scope.setTag("listener", "conditional-order");
      scope.setContext("conditional_order_event", eventContext);
      sentryEventId = Sentry.captureException(normalizedError);
    });
  } catch (sentryError) {
    log.error("Sentry capture failed", { errorId }, sentryError);
  }

  log.error(
    `conditional order skipped after processing error (errorId=${errorId})`,
    { ...eventContext, sentryEventId },
    normalizedError
  );
}
