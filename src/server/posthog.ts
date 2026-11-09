import { PostHog } from "posthog-node";

interface CaptureClient {
  capture: (event: Parameters<PostHog["capture"]>[0]) => void;
  captureException: (...args: Parameters<PostHog["captureException"]>) => void;
  flush: () => Promise<void>;
}

let cachedClient: CaptureClient | null = null;

const noopClient: CaptureClient = {
  capture: () => undefined,
  captureException: () => undefined,
  flush: async () => undefined,
};

export function getPostHogClient(): CaptureClient {
  if (cachedClient) return cachedClient;

  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!projectToken || !host) {
    if (process.env.NODE_ENV === "development") {
      const missingVariable = projectToken
        ? "NEXT_PUBLIC_POSTHOG_HOST"
        : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
      console.error(
        new Error(
          `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`
        )
      );
    }
    cachedClient = noopClient;
    return cachedClient;
  }

  cachedClient = new PostHog(projectToken, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });
  return cachedClient;
}
