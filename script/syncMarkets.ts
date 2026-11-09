#!/usr/bin/env tsx
import "dotenv/config";
import { MarketUpdateService } from "../src/backend/services/marketUpdateService";

const stats = await MarketUpdateService.updateMarkets();
process.exit(stats ? 0 : 1);
