import type { ProtocolVersion } from "@/shared/polymarket/protocol";

export interface Market {
  id: string;
  slug: string;
  /** Parent event slug — distinct from `slug` for events with multiple markets. */
  eventSlug: string | null;
  question: string;
  description: string | null;
  category: string | null;
  tags: string[];
  outcomes: string[];
  volume: number;
  liquidity: number;
  endDate: Date | null;
  clobTokenIds: string[];
  protocolVersion: ProtocolVersion | null;
  positionIds: string[];
  conditionId: string | null;
  active: boolean;
  negRisk: boolean;
}

export interface MarketRow {
  id: string;
  slug: string;
  event_slug: string | null;
  question: string;
  description: string | null;
  category: string | null;
  tags: string[];
  outcomes: string[];
  volume: number;
  liquidity: number;
  end_date: Date | null;
  clob_token_ids: string[];
  protocol_version: ProtocolVersion | null;
  position_ids: string[];
  condition_id: string | null;
  active: boolean;
  neg_risk: boolean;
  updated_at?: Date;
}
