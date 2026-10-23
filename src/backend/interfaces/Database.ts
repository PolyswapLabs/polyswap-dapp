import type { ProtocolVersion } from "../../lib/polymarket/protocol";

export interface DatabaseMarket {
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
