#!/usr/bin/env tsx
import "dotenv/config";
import { MarketSyncService } from "../src/backend/services/marketSyncService";

const result = await MarketSyncService.updateMarkets();
process.exit(result.status === "completed" ? 0 : 1);
