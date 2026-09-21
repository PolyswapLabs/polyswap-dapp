import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = async (...args: Parameters<typeof Sentry.captureRequestError>) => {
  Sentry.captureRequestError(...args);

  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getPostHogClient } = await import("./lib/posthog-server");
  const posthog = getPostHogClient();
  const tracingDistinctId = args[1].headers["x-posthog-distinct-id"];
  const distinctId = Array.isArray(tracingDistinctId) ? tracingDistinctId[0] : tracingDistinctId;
  posthog.captureException(args[0], distinctId);
  await posthog.flush();
};
