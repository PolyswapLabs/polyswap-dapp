#!/usr/bin/env tsx
import "dotenv/config";
import { MarketUpdateService } from "../src/backend/services/marketUpdateService";

const result = await MarketUpdateService.updateMarkets();
process.exit(result.status === "completed" ? 0 : 1);
