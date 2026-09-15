// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import Sentry from "@sentry/nextjs";
import { isProductionEnvironment } from "./src/lib/env";

if (isProductionEnvironment()) {
  const isListener = process.env.POLYSWAP_SENTRY_RUNTIME === "listener";

  Sentry.init({
    dsn: "https://d190690c303492020ebc0c241b5bd560@o4510743731175424.ingest.de.sentry.io/4510743738974288",
    // The listener performs recurrent database and RPC operations. Do not send
    // their successful spans; errors remain available through exception events
    // and the error-only console logging integration below.
    tracesSampleRate: isListener ? 0 : 1,
    enableLogs: true,
    integrations: isListener
      ? (defaultIntegrations) => [
          ...defaultIntegrations.filter(({ name }) => name !== "ConsoleLogs"),
          Sentry.consoleLoggingIntegration({ levels: ["error"] }),
        ]
      : undefined,
    beforeSendLog: isListener
      ? (log) => (log.level === "error" || log.level === "fatal" ? log : null)
      : undefined,
    sendDefaultPii: true,
  });
}
