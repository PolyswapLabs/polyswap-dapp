#!/usr/bin/env tsx
import "dotenv/config";
import { PolymarketPositionSellerService } from "../src/backend/services/polymarketPositionSellerService";
import { prisma } from "../src/backend/db/prisma";

// Use the same version-aware inventory, approvals and submission path as the listener.
await PolymarketPositionSellerService.triggerSell();
await prisma.$disconnect();
