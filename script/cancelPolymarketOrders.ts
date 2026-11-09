#!/usr/bin/env tsx

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "..", ".env") });

import { getPolymarketOrderService } from "../src/backend/polymarket/clob";
import { createLogger } from "../src/backend/logger.js";

const log = createLogger("cancel-orders");

async function cancelAllOrders() {
  log.info("starting cancel-all-orders");
  log.info(
    `env: PK=${process.env.PK ? "set" : "MISSING"}, ` +
      `CLOB_API_KEY=${process.env.CLOB_API_KEY ? "set" : "MISSING"}, ` +
      `CLOB_SECRET=${process.env.CLOB_SECRET ? "set" : "MISSING"}`
  );

  if (!process.env.PK) {
    log.error("private key (PK) is not set");
    process.exit(1);
  }

  try {
    const polymarketOrderService = getPolymarketOrderService();
    await polymarketOrderService.initialize();
    if (!polymarketOrderService.isReady()) {
      throw new Error("polymarket service is not ready");
    }
    log.info("service initialized");

    log.info("canceling all open Polymarket orders");
    const result = await polymarketOrderService.cancelAllOrders();
    log.info(`canceled all orders; result: ${JSON.stringify(result)}`);
  } catch (error) {
    log.error("failed to cancel orders:", error);
    process.exit(1);
  }
}

cancelAllOrders()
  .then(() => {
    log.info("done");
    process.exit(0);
  })
  .catch((error) => {
    log.error("fatal:", error);
    process.exit(1);
  });

export default cancelAllOrders;
