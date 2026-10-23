#!/usr/bin/env node --import tsx
// Public, read-only smoke check: no dotenv, private key, SDK auth or database import.
import assert from "node:assert/strict";
import { PROTOCOL_VERSIONS, getTradingAssetIds } from "../src/lib/polymarket/protocol";
import { PolymarketAPIService } from "../src/backend/services/polymarketAPIService";
import { PolymarketDataClient } from "../src/backend/polymarket/data";
import { fetchClobPriceHistory } from "../src/services/polymarket";

for (const version of PROTOCOL_VERSIONS) {
  const markets = await PolymarketAPIService.getOpenMarkets({
    versions: [version],
    limit: 5,
    maxNb: 20,
  });
  let checked = false;
  for (const market of markets) {
    assert.equal(market.protocolVersion, version);
    const [assetId] = getTradingAssetIds(market);
    assert.ok(assetId);
    const response = await fetch(`https://clob.polymarket.com/book?token_id=${assetId}`, {
      signal: AbortSignal.timeout(15000),
    });
    // Gamma may contain upcoming/closed books; select a currently served canary.
    if (response.status === 404) continue;
    assert.equal(response.status, 200);
    const book = await response.json();
    assert.equal(book.asset_id, assetId);
    const history = await fetchClobPriceHistory(assetId);
    console.log(
      `${version}: market=${market.id}, book=${book.bids.length} bids/${book.asks.length} asks, history=${history.length} points`
    );
    checked = true;
    break;
  }
  assert.ok(checked, `No served ${version} order book found among ${markets.length} candidates`);
}
const positions = await new PolymarketDataClient().fetchPositions(
  "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a"
);
console.log(
  `Data API v2 envelope/pagination verified: ${positions.length} positions for a public test EOA`
);
