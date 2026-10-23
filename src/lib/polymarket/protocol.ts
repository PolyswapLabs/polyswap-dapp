/** Shared by market ingestion, API validation and browser price requests. */
export const PROTOCOL_VERSIONS = ["v1", "v2"] as const;
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

export function parseProtocolVersion(value: unknown): ProtocolVersion {
  if (value !== "v1" && value !== "v2") {
    throw new Error(`Unsupported Polymarket protocol version: ${String(value)}`);
  }
  return value;
}

/** Gamma encodes legacy arrays as JSON text and V2 position IDs as arrays. */
export function parseStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

export interface MarketAssets {
  protocolVersion: unknown;
  outcomes: unknown;
  clobTokenIds: unknown;
  positionIds: unknown;
}

export function assertAssetId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9]+$/.test(value) ||
    BigInt(value) <= 0n ||
    BigInt(value) >= 1n << 256n
  ) {
    throw new Error("Polymarket asset ID must be a positive uint256 decimal string");
  }
}

/** Never infer the protocol from field presence: both arrays may be populated. */
export function getTradingAssetIds(market: MarketAssets): string[] {
  const version = parseProtocolVersion(market.protocolVersion);
  const ids = parseStringArray(version === "v2" ? market.positionIds : market.clobTokenIds);
  const outcomes = parseStringArray(market.outcomes);
  if (outcomes.length < 2 || ids.length !== outcomes.length || new Set(ids).size !== ids.length) {
    throw new Error("Polymarket outcome IDs do not match the market outcomes");
  }
  ids.forEach(assertAssetId);
  return ids;
}
