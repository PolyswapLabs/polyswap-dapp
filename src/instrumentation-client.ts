// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { isProductionEnvironment } from "@/lib/env";

const posthogProjectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if ((!posthogProjectToken || !posthogHost) && process.env.NODE_ENV === "development") {
  const missingVariable = posthogProjectToken
    ? "NEXT_PUBLIC_POSTHOG_HOST"
    : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
  console.error(
    new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`
    )
  );
}

if (isProductionEnvironment()) {
  Sentry.init({
    dsn: "https://d190690c303492020ebc0c241b5bd560@o4510743731175424.ingest.de.sentry.io/4510743738974288",
    integrations: [Sentry.replayIntegration()],
    tracesSampleRate: 1,
    enableLogs: true,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: true,
  });

  if (posthogProjectToken && posthogHost) {
    posthog.init(posthogProjectToken, {
      api_host: "/ingest",
      ui_host: posthogHost,
      defaults: "2026-01-30",
      capture_exceptions: true,
      addTracingHeaders: [window.location.hostname],
      debug: false,
    });
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
