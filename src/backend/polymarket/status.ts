import { createLogger } from "@/backend/logger";

const log = createLogger("polymarket-status");

const COMPONENTS_URL = "https://status.polymarket.com/v3/components.json";
const CLOB_COMPONENT_NAME = "CLOB API";
const FETCH_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 30_000;

interface StatusComponent {
  name: string;
  status: string;
}

interface ClobAvailability {
  available: boolean;
  reason?: string;
}

const AVAILABLE: ClobAvailability = { available: true };

function reasonForStatus(status: string): string {
  switch (status.toUpperCase()) {
    case "UNDERMAINTENANCE":
      return "Polymarket's order service is under maintenance. This is on Polymarket's side — please try again once it's back.";
    case "MAJOROUTAGE":
    case "PARTIALOUTAGE":
      return "Polymarket's order service is currently down. This is on Polymarket's side — please try again shortly.";
    case "DEGRADEDPERFORMANCE":
      return "Polymarket's order service is degraded right now. This is on Polymarket's side — please try again in a few minutes.";
    default:
      return "Polymarket's order service is unavailable right now. This is on Polymarket's side — please try again shortly.";
  }
}

let cached: { value: ClobAvailability; at: number } | null = null;

// Conservative: returns available unless the status page positively reports CLOB down.
export async function getClobAvailability(): Promise<ClobAvailability> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  let value = AVAILABLE;
  try {
    const res = await fetch(COMPONENTS_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (res.ok) {
      const json = (await res.json()) as { components?: StatusComponent[] };
      const clob = json.components?.find((c) => c.name === CLOB_COMPONENT_NAME);
      if (clob && clob.status.toUpperCase() !== "OPERATIONAL") {
        value = { available: false, reason: reasonForStatus(clob.status) };
        log.warn(`Polymarket CLOB API reported as ${clob.status}`);
      }
    } else {
      log.debug(`status page returned HTTP ${res.status}; assuming available`);
    }
  } catch (err) {
    log.debug(
      `status page unreachable, assuming available: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  cached = { value, at: now };
  return value;
}
