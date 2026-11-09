#!/usr/bin/env tsx
import "dotenv/config";
import { getPolymarketOrderService } from "../src/backend/polymarket/clob";

// Explicit operator command. This sends approval transactions; never run by checks.
if (!process.argv.includes("--execute")) {
  throw new Error("Approval transactions require the explicit --execute flag");
}
const service = getPolymarketOrderService();
await service.initialize();
for (const context of [
  { protocolVersion: "v1", negRisk: false },
  { protocolVersion: "v1", negRisk: true },
  { protocolVersion: "v2", negRisk: false },
] as const) {
  await service.ensureTradingApprovals(context);
  console.log(
    `${context.protocolVersion} ${context.negRisk ? "NegRisk" : "standard"} approvals confirmed`
  );
}
