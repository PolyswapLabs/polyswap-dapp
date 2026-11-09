"use client";

import posthog from "posthog-js";
import { isProductionEnvironment } from "@/lib/env";

type EventProperties = Record<string, string | number | boolean | null | undefined>;

export function isPostHogEnabled(): boolean {
  return (
    isProductionEnvironment() &&
    Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) &&
    Boolean(process.env.NEXT_PUBLIC_POSTHOG_HOST)
  );
}

export function capturePostHogEvent(event: string, properties?: EventProperties) {
  if (!isPostHogEnabled()) return;
  posthog.capture(event, properties);
}

export function capturePostHogException(error: Error) {
  if (!isPostHogEnabled()) return;
  posthog.captureException(error);
}
