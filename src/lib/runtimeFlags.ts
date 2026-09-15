function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function isOrderCreationDisabled(): boolean {
  return isEnabled(process.env.ORDER_CREATION_DISABLED);
}

export function isDappMaintenanceMode(): boolean {
  return isEnabled(process.env.DAPP_MAINTENANCE);
}

/** Post-only is the safe default and can only be disabled explicitly. */
export function isPolymarketSentinelPostOnly(): boolean {
  const value = process.env.POLYMARKET_SENTINEL_POST_ONLY?.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value ?? "");
}
