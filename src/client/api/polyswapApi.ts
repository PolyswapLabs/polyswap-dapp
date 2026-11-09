import { isRecord } from "@/shared/guards";
import type { Address, Hex } from "viem";
import { type MarketRow } from "@/backend/interfaces/Market";
import { type PublicPolyswapOrder } from "@/backend/interfaces/PolyswapOrder";

// ---------------------------------------------------------------------------
// PolySwap Order types (consolidated POST /polyswap/orders)
// ---------------------------------------------------------------------------

interface CreatePolyswapOrderRequest {
  sellToken: Address;
  buyToken: Address;
  sellAmount: string;
  minBuyAmount?: string;
  selectedOutcome: string;
  betPercentage: number;
  startDate?: string;
  deadline?: string;
  marketId: string;
  owner: Address;
}

interface PolyswapTxCall {
  to: Address;
  data: Hex;
  value: string;
}

interface CreatePolyswapOrderResponse {
  orderId: number;
  polymarketOrderHash: string;
  orderHash: string;
  tx: PolyswapTxCall;
  batchTx: PolyswapTxCall[];
  /**
   * Self-call that installs CoW's ExtensibleFallbackHandler on a fresh Safe.
   * Null when the Safe already has the right handler (or when the owner is
   * an EOA / detection failed). When present, prepend to whichever calls are
   * submitted so the very first order leaves the Safe fully provisioned.
   */
  fallbackSetupTx: PolyswapTxCall | null;
  sellToken: Address;
  sellAmount: string;
  vaultRelayer: Address;
}

interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
}

interface OrdersResponse {
  success: boolean;
  data?: PublicPolyswapOrder[];
  count?: number;
  pagination?: { limit: number; offset: number; hasMore: boolean };
  message?: string;
  error?: string;
}

function isPolyswapTxCall(value: unknown): value is PolyswapTxCall {
  return (
    isRecord(value) &&
    typeof value.to === "string" &&
    typeof value.data === "string" &&
    typeof value.value === "string"
  );
}

function isCreateOrderSuccess(
  json: unknown
): json is ApiSuccessEnvelope<CreatePolyswapOrderResponse> {
  if (!isRecord(json)) return false;
  if (json.success !== true) return false;
  if (!isRecord(json.data)) return false;
  const d = json.data;
  return (
    typeof d.orderId === "number" &&
    typeof d.polymarketOrderHash === "string" &&
    typeof d.orderHash === "string" &&
    isPolyswapTxCall(d.tx) &&
    Array.isArray(d.batchTx) &&
    d.batchTx.every(isPolyswapTxCall) &&
    (d.fallbackSetupTx === null || isPolyswapTxCall(d.fallbackSetupTx)) &&
    typeof d.sellToken === "string" &&
    typeof d.sellAmount === "string" &&
    typeof d.vaultRelayer === "string"
  );
}

function readApiErrorMessage(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined;
  const message = typeof json.message === "string" ? json.message : undefined;
  const error = typeof json.error === "string" ? json.error : undefined;
  const errorId = typeof json.errorId === "string" ? json.errorId : undefined;
  const text = message ?? error;
  return text && errorId ? `${text} Error ID: ${errorId}` : text;
}

export function isSuccessEnvelope<T = unknown>(value: unknown): value is ApiSuccessEnvelope<T> {
  return isRecord(value) && value.success === true;
}

function isMarketEnvelope(value: unknown): value is ApiSuccessEnvelope<MarketRow> {
  return isSuccessEnvelope(value) && isRecord(value.data);
}

function isOrdersResponse(value: unknown): value is OrdersResponse {
  return isRecord(value);
}

export async function readApiResponse<T>(
  response: Response,
  isExpected: (json: unknown) => json is T
): Promise<T> {
  const json: unknown = await response.json();
  if (response.ok && isExpected(json)) return json;
  throw new Error(
    readApiErrorMessage(json) ?? (response.ok ? "Invalid API response" : `HTTP ${response.status}`)
  );
}

const API_BASE = "/api";

export async function getMarketBySlug(
  slug: string,
  opts: { track?: boolean } = {}
): Promise<MarketRow | null> {
  const url = `${API_BASE}/markets/${encodeURIComponent(slug)}${opts.track ? "?track=1" : ""}`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  return (await readApiResponse(response, isMarketEnvelope)).data;
}

export async function createPolyswapOrder(
  body: CreatePolyswapOrderRequest
): Promise<CreatePolyswapOrderResponse> {
  const response = await fetch(`${API_BASE}/polyswap/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await readApiResponse(response, isCreateOrderSuccess)).data;
}

export async function getOrdersByOwner(
  ownerAddress: string,
  limit: number = 100,
  offset: number = 0
): Promise<OrdersResponse> {
  const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
  const response = await fetch(`${API_BASE}/polyswap/orders/${ownerAddress}?${params}`);
  return readApiResponse(response, isOrdersResponse);
}

/**
 * Off-chain draft cancellation: DELETEs the row.
 * Auth: EIP-191 message signed via useSignAction("cancel_draft", String(orderId)).
 */
export async function deleteDraftOrder(
  orderId: number,
  signature: string,
  timestamp: number
): Promise<void> {
  const res = await fetch(`${API_BASE}/polyswap/orders/id/${orderId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature, timestamp }),
  });
  await readApiResponse(res, isSuccessEnvelope);
}

/**
 * Server-side finalisation after the on-chain ComposableCoW.remove(orderHash)
 * has been confirmed. Auth: EIP-191 message signed via
 * useSignAction("notify_remove", String(orderId)).
 */
export async function notifyRemoveOrder(
  orderId: number,
  signature: string,
  timestamp: number
): Promise<void> {
  const res = await fetch(`${API_BASE}/polyswap/orders/id/${orderId}/notify-remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature, timestamp }),
  });
  await readApiResponse(res, isSuccessEnvelope);
}
