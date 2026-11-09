// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import Sentry from "@sentry/nextjs";
import { isProductionEnvironment, SENTRY_DSN } from "./src/shared/env";

if (isProductionEnvironment()) {
  const isListener = process.env.POLYSWAP_SENTRY_RUNTIME === "listener";

  Sentry.init({
    dsn: SENTRY_DSN,
    // The listener performs recurrent database and RPC operations. Do not send
    // their successful spans; errors remain available through exception events
    // and recoverable warnings/errors through the console logging integration.
    tracesSampleRate: isListener ? 0 : 1,
    enableLogs: true,
    integrations: isListener
      ? (defaultIntegrations) => [
          ...defaultIntegrations.filter(({ name }) => name !== "ConsoleLogs"),
          Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
        ]
      : undefined,
    beforeSendLog: isListener
      ? (log) =>
          log.level === "warn" || log.level === "error" || log.level === "fatal" ? log : null
      : undefined,
    sendDefaultPii: true,
  });
}
