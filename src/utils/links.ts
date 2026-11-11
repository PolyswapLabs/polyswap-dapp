export function polymarketEventUrl(market: { slug: string; eventSlug: string | null }): string {
  return `https://polymarket.com/event/${market.eventSlug ?? market.slug}`;
}

export function polygonscanTxUrl(hash: string): string {
  return `https://polygonscan.com/tx/${hash}`;
}

export function polygonscanTokenUrl(address: string): string {
  return `https://polygonscan.com/token/${address}`;
}

/** Pairs a market title in the list with the same title on its detail page. */
export function marketTitleTransitionName(marketId: string): string {
  return `market-title-${marketId}`;
}
