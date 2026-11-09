import { Prisma } from "@prisma/client";
import type { Market } from "../interfaces/Market";

/** markets.volume and markets.liquidity are NUMERIC(30, 6). */
const DECIMAL_SCALE = 6;

export type StoredMarket = Omit<
  Market,
  "volume" | "liquidity" | "active" | "outcomes" | "protocolVersion"
> & {
  volume: Prisma.Decimal | null;
  liquidity: Prisma.Decimal | null;
  active: boolean | null;
  outcomes: Prisma.JsonValue;
  protocolVersion: string | null;
};

interface MarketDiff {
  changed: Market[];
  /** IDs of existing rows whose indexed text changed. New rows start with a null vector. */
  searchStale: string[];
}

/** Gamma sends floats, so compare what Postgres would store after rounding, not the raw value. */
function sameDecimal(incoming: number, stored: Prisma.Decimal | null): boolean {
  return (
    stored !== null && new Prisma.Decimal(incoming).toDecimalPlaces(DECIMAL_SCALE).equals(stored)
  );
}

function sameStrings(incoming: string[], stored: string[] | null): boolean {
  return (
    stored !== null &&
    incoming.length === stored.length &&
    incoming.every((value, index) => value === stored[index])
  );
}

function sameDate(incoming: Date | null, stored: Date | null): boolean {
  return incoming?.getTime() === stored?.getTime();
}

function sameSearchText(incoming: Market, stored: StoredMarket): boolean {
  return (
    incoming.slug === stored.slug &&
    incoming.question === stored.question &&
    incoming.description === stored.description &&
    sameStrings(incoming.tags, stored.tags)
  );
}

function sameMarket(incoming: Market, stored: StoredMarket): boolean {
  return (
    sameSearchText(incoming, stored) &&
    incoming.eventSlug === stored.eventSlug &&
    incoming.category === stored.category &&
    JSON.stringify(incoming.outcomes) === JSON.stringify(stored.outcomes) &&
    sameDecimal(incoming.volume, stored.volume) &&
    sameDecimal(incoming.liquidity, stored.liquidity) &&
    sameDate(incoming.endDate, stored.endDate) &&
    sameStrings(incoming.clobTokenIds, stored.clobTokenIds) &&
    incoming.protocolVersion === stored.protocolVersion &&
    sameStrings(incoming.positionIds, stored.positionIds) &&
    incoming.conditionId === stored.conditionId &&
    incoming.active === stored.active &&
    incoming.negRisk === stored.negRisk
  );
}

export function diffMarkets(incoming: Market[], existing: StoredMarket[]): MarketDiff {
  const storedById = new Map(existing.map((row) => [row.id, row]));
  const diff: MarketDiff = { changed: [], searchStale: [] };
  for (const market of incoming) {
    const stored = storedById.get(market.id);
    if (!stored) {
      diff.changed.push(market);
    } else if (!sameMarket(market, stored)) {
      diff.changed.push(market);
      if (!sameSearchText(market, stored)) diff.searchStale.push(market.id);
    }
  }
  return diff;
}
