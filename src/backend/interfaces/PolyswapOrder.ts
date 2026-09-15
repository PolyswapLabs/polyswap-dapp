export interface PolyswapOrderData {
  sellToken: string; // hex address
  buyToken: string; // hex address
  receiver: string; // hex address
  sellAmount: string; // uint256 as string
  minBuyAmount: string; // uint256 as string
  t0: string; // uint256 timestamp as string
  t: string; // uint256 timestamp as string
  polymarketOrderHash: string; // bytes32 hex string
  appData: string; // bytes32 hex string
  polymarketMakerAmount: string; // uint256 as string; "" for legacy V1 orders
}

export interface ConditionalOrderParams {
  handler: string; // address
  salt: string; // bytes32
  staticInput: string; // bytes (ABI-encoded)
}

export interface ConditionalOrderCreatedEvent {
  owner: string;
  params: ConditionalOrderParams;
  orderHash?: string; // calculated hash
  blockNumber?: number;
  transactionHash?: string;
  logIndex?: number;
}

export interface PolyswapOrderRecord {
  orderHash: string;
  owner: string;
  handler: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  minBuyAmount: string;
  startTime: number;
  endTime: number;
  polymarketOrderHash: string;
  appData: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  createdAt: Date;
  salt?: string;
  polymarketMakerAmount?: string | null;
}

// Database interface for the polyswap_orders table
export interface DatabasePolyswapOrder {
  id: number;
  order_hash: string | null;
  owner: string;
  handler: string;
  sell_token: string;
  buy_token: string;
  sell_amount: string;
  min_buy_amount: string;
  start_time: Date;
  end_time: Date;
  polymarket_order_hash: string;
  app_data: string;
  block_number: number;
  transaction_hash: string;
  log_index: number;
  market_id: string | null;
  outcome_selected: string | null; // Selected outcome index
  bet_percentage: number | null; // Bet percentage (0-100)
  status: "draft" | "live" | "filled" | "canceled" | "errored" | "expired";
  order_uid: string | null; // CoW Protocol order UID
  salt: string | null;
  explicit_deadline: boolean;
  polymarket_maker_amount: string | null;
  sentinel_id: number | null;
  last_error_name: string | null;
  last_error_reason: string | null;
  last_error_retry_at: string | null; // BIGINT — pg returns string
  last_checked_at: Date | null;
  cow_order_status: "presignaturePending" | "open" | "fulfilled" | "cancelled" | "expired" | null;
  filled_at: Date | null;
  gate_opened_at: Date | null;
  actual_sell_amount: string | null;
  actual_buy_amount: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Public order shape returned by the API. It intentionally excludes backend
 * execution details such as the sentinel id, Polymarket hash, handler, salt,
 * appData, transaction metadata, and internal timestamps.
 */
export interface PublicPolyswapOrder {
  id: number;
  order_hash: string | null;
  sell_token: string;
  buy_token: string;
  sell_amount: string;
  start_time: string;
  end_time: string;
  market_id: string | null;
  outcome_selected: string | null;
  bet_percentage: number | null;
  status: DatabasePolyswapOrder["status"];
  order_uid: string | null;
  last_error_reason: string | null;
  last_error_retry_at: string | null;
  filled_at: string | null;
  gate_opened_at: string | null;
  actual_sell_amount: string | null;
  actual_buy_amount: string | null;
}

export type PolymarketSentinelStatus =
  | "prepared"
  | "activating"
  | "live"
  | "filled"
  | "canceled"
  | "failed";

export interface DatabasePolymarketSentinel {
  id: number;
  market_id: string;
  token_id: string;
  outcome_selected: string;
  price_cents: number;
  neg_risk: boolean;
  post_only: boolean;
  epoch: number;
  polymarket_order_hash: string;
  polymarket_maker_amount: string;
  signed_order: unknown;
  expiration: Date;
  status: PolymarketSentinelStatus;
  activation_tx_hash: string | null;
  last_error: string | null;
  activated_at: Date | null;
  filled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Interface for sold positions tracking
export interface SoldPosition {
  id: number;
  asset_id: string; // Polymarket token ID
  condition_id: string;
  size: number;
  sell_price: number;
  current_price: number;
  order_id: string;
  market_title: string;
  outcome: string;
  sold_at: Date;
}

// Input interface for recording a sold position
export interface SoldPositionInput {
  assetId: string;
  conditionId: string;
  size: number;
  sellPrice: number;
  currentPrice: number;
  orderId: string;
  marketTitle: string;
  outcome: string;
}
