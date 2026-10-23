#!/usr/bin/env tsx
import "dotenv/config";
import { createPublicClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { resilientHttp } from "../src/lib/rpc/resilientHttp";
import { getPolymarketOrderService } from "../src/backend/services/polymarketOrderService";
import { PolymarketInventory, sharesFromBalance } from "../src/backend/polymarket/inventory";
import { createLogger } from "../src/backend/logger";

const log = createLogger("check-orders");
const pk = process.env.PK;
if (!pk) throw new Error("Private key (PK) is not configured");
const owner = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex).address;
const client = createPublicClient({
  chain: polygon,
  transport: resilientHttp(process.env.RPC_URL ?? "https://polygon.drpc.org"),
});
const service = getPolymarketOrderService();
await service.initialize();
// Read-only: no approvals, submissions, cancellations or database writes.
for (const order of await service.getOpenOrders()) {
  log.info(
    `${order.side} ${order.assetId}: ${order.sizeMatched}/${order.originalSize} shares at ${order.price}; ${order.status}`
  );
}
for (const position of await new PolymarketInventory(client, owner).read({
  onScanError: (error, protocolVersion) =>
    log.warn(`Position transfer scan failed (${protocolVersion ?? "block number"}):`, error),
})) {
  log.info(
    `${position.protocolVersion} ${position.assetId}: ${sharesFromBalance(position.balance)} shares; ${position.metadata?.title ?? "unindexed"}`
  );
}
