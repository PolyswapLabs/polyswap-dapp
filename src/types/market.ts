import type { ProtocolVersion } from "../lib/polymarket/protocol";
export interface MarketOption {
  id: string;
  label: string;
  odds: number;
  color?: string;
}

export interface Market {
  id: string;
  title: string;
  description: string;
  volume: number;
  endDate: string;
  category: string;
  isActive: boolean;
  type: "binary" | "multi-choice";

  // For binary markets (Yes/No)
  yesOdds?: number;
  noOdds?: number;

  // For multi-choice markets (elections, etc.)
  options?: MarketOption[];

  // Additional fields for Polymarket integration
  slug: string;
  eventSlug?: string; // Parent event slug for Polymarket links (used for multi-choice markets)
  clobTokenIds: string[];
  protocolVersion: ProtocolVersion | null;
  positionIds: string[];
  conditionId?: string;
}

export interface MarketCardProps {
  market: Market;
  onClick?: (market: Market) => void;
}
