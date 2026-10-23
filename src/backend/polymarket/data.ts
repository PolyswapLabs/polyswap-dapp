import { assertAssetId } from "../../lib/polymarket/protocol";
import { getRetryAt, sleep } from "../utils/httpRetry";

export interface PolymarketPosition {
  assetId: string;
  conditionId: string;
  size: number;
  currentPrice: number;
  title: string;
  outcome: string;
  negRisk: boolean;
  redeemable: boolean;
}

export class PositionsRateLimitError extends Error {
  constructor(readonly retryAt: number) {
    super(`Positions API rate limited until ${new Date(retryAt).toISOString()}`);
  }
}

function parsePositionDecimal(value: unknown, field: string): number {
  const normalized =
    typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
      ? Number(value)
      : value;
  if (typeof normalized !== "number" || !Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`Invalid position ${field}`);
  }
  return normalized;
}

export function parsePosition(value: unknown): PolymarketPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Data API position");
  }
  const row = value as Record<string, unknown>;
  assertAssetId(row.token_id);
  const size = parsePositionDecimal(row.current_size, "current_size");
  const currentPrice = parsePositionDecimal(row.current_price, "current_price");
  if (
    typeof row.condition_id !== "string" ||
    typeof row.negative_risk !== "boolean" ||
    typeof row.redeemable !== "boolean"
  ) {
    throw new Error("Invalid position metadata");
  }
  return {
    assetId: row.token_id,
    conditionId: row.condition_id,
    size,
    currentPrice,
    title: typeof row.title === "string" ? row.title : "",
    outcome: typeof row.outcome === "string" ? row.outcome : "",
    negRisk: row.negative_risk,
    redeemable: row.redeemable,
  };
}

/** Data API v2 supports both position systems. Cursors are opaque and scoped to a query. */
export class PolymarketDataClient {
  private blockedUntil = 0;

  constructor(
    private readonly options: {
      fetch?: typeof fetch;
      baseUrl?: string;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {}
  ) {}

  async fetchPositions(user: string): Promise<PolymarketPosition[]> {
    const positions = new Map<string, PolymarketPosition>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const url = new URL(
        "/v2/positions",
        this.options.baseUrl ??
          process.env.POLYMARKET_DATA_API_URL ??
          "https://data-api.polymarket.com"
      );
      url.searchParams.set("user", user);
      url.searchParams.set("status", "OPEN");
      url.searchParams.set("filter_amount", "0");
      if (cursor) url.searchParams.set("cursor", cursor);
      else url.searchParams.set("limit", "1000");
      const page = await this.request(url);
      if (!page || typeof page !== "object") throw new Error("Invalid positions envelope");
      const { data, pagination } = page as {
        data?: unknown;
        pagination?: { next_cursor?: unknown };
      };
      if (
        !Array.isArray(data) ||
        !pagination ||
        !(
          pagination.next_cursor === null ||
          (typeof pagination.next_cursor === "string" && pagination.next_cursor.length > 0)
        )
      ) {
        throw new Error("Invalid positions pagination");
      }
      for (const raw of data) {
        const position = parsePosition(raw);
        positions.set(position.assetId, position);
      }
      cursor = pagination.next_cursor;
      if (cursor) {
        if (cursors.has(cursor)) throw new Error("Positions API returned a repeated cursor");
        cursors.add(cursor);
      }
    } while (cursor);
    return [...positions.values()];
  }

  private async request(url: URL): Promise<unknown> {
    const now = this.options.now ?? Date.now;
    if (now() < this.blockedUntil) throw new PositionsRateLimitError(this.blockedUntil);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return response.json();
      if (response.status !== 429) {
        throw new Error(
          `Positions API returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`
        );
      }
      const retryAt = getRetryAt(response.headers.get("retry-after"), now(), 1000 * 2 ** attempt);
      this.blockedUntil = Math.max(this.blockedUntil, retryAt);
      if (attempt === 2 || retryAt - now() > 10_000) {
        this.blockedUntil = Math.max(this.blockedUntil, now() + 60_000);
        throw new PositionsRateLimitError(this.blockedUntil);
      }
      await (this.options.sleep ?? sleep)(Math.max(0, retryAt - now()));
    }
    throw new Error("Positions API retry exhausted");
  }
}
