"use client";

import posthog from "posthog-js";
import { isProductionEnvironment } from "@/lib/env";

type EventProperties = Record<string, string | number | boolean | null | undefined>;

function isPostHogConfigured() {
  return (
    isProductionEnvironment() &&
    Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) &&
    Boolean(process.env.NEXT_PUBLIC_POSTHOG_HOST)
  );
}

export function capturePostHogEvent(event: string, properties?: EventProperties) {
  if (!isPostHogConfigured()) return;
  posthog.capture(event, properties);
}

export function capturePostHogException(error: Error) {
  if (!isPostHogConfigured()) return;
  posthog.captureException(error);
}
