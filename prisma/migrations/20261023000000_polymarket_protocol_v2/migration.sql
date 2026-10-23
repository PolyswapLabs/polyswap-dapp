-- Additive metadata migration. Run explicitly against the intended database.
-- Unknown cached markets stay unclassified until refreshed from Gamma.
ALTER TABLE "markets"
  ADD COLUMN "protocol_version" VARCHAR(2),
  ADD COLUMN "position_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "condition_id" VARCHAR(66),
  ADD CONSTRAINT "markets_protocol_version_check" CHECK ("protocol_version" IN ('v1', 'v2'));

-- All historical PolySwap sentinels used CTF exchanges/domain version 2.
-- Preserve their signed JSON and hashes. A null exchange uses the legacy
-- environment configuration and is verified against the committed order hash.
ALTER TABLE "polymarket_sentinels"
  ADD COLUMN "protocol_version" VARCHAR(2) NOT NULL DEFAULT 'v1',
  ADD COLUMN "exchange_address" VARCHAR(42),
  ADD COLUMN "signed_order_format" VARCHAR(20) NOT NULL DEFAULT 'clob-v2',
  ADD CONSTRAINT "sentinels_protocol_version_check" CHECK ("protocol_version" IN ('v1', 'v2'));

DROP INDEX "uq_sentinel_bucket_epoch";
CREATE UNIQUE INDEX "uq_sentinel_bucket_epoch" ON "polymarket_sentinels" ("market_id", "protocol_version", "token_id", "price_cents", "epoch");
DROP INDEX "idx_sentinel_reuse";
CREATE INDEX "idx_sentinel_reuse" ON "polymarket_sentinels" ("market_id", "protocol_version", "token_id", "price_cents", "status");

ALTER TABLE "sold_positions"
  ADD COLUMN "protocol_version" VARCHAR(2),
  ADD CONSTRAINT "sold_positions_protocol_version_check" CHECK ("protocol_version" IN ('v1', 'v2'));
