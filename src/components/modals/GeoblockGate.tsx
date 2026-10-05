"use client";

import { useEffect, useState } from "react";
import { UnavailableModal } from "./UnavailableModal";

const POLYMARKET_DATA_URL =
  "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=1";
const REQUEST_TIMEOUT_MS = 8_000;

type Availability = { status: "checking" } | { status: "available" } | { status: "unverified" };

/**
 * PolySwap only needs Polymarket's public market data before a visitor enters
 * the app. Use the exact data API it relies on instead of maintaining a local
 * country policy: network, malformed-response, and non-429 HTTP failures leave
 * the app unavailable. Rate limiting permits the database recommendation fallback.
 */
export function PolymarketDataGate({ children }: { children: React.ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [availability, setAvailability] = useState<Availability>({ status: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let current = true;

    async function checkDataAvailability() {
      setAvailability({ status: "checking" });

      try {
        const response = await fetch(POLYMARKET_DATA_URL, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });

        if (response.status === 429) {
          if (current) setAvailability({ status: "available" });
          return;
        }
        if (!response.ok) throw new Error(`Polymarket data returned ${response.status}`);

        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error("Invalid Polymarket data response");

        if (!current) return;
        setAvailability({ status: "available" });
      } catch {
        // Browser fetches intentionally hide the low-level cause of many ISP blocks.
        // Other failed or malformed data requests remain unavailable.
        if (current) setAvailability({ status: "unverified" });
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkDataAvailability();

    return () => {
      current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  // Avoid flashing a dialog while the availability probe is in flight.
  if (availability.status === "available" || availability.status === "checking") {
    return <>{children}</>;
  }

  return (
    <UnavailableModal
      heading="We can’t reach Polymarket data"
      body="Polyswap needs Polymarket market data before it can be used. Your country may block some Polymarket API request or you may have connection issues."
      retryLabel="Retry data check"
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
