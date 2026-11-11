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

function isMarketMapEnvelope(
  value: unknown
): value is ApiSuccessEnvelope<Record<string, MarketRow>> {
  return (
    isSuccessEnvelope(value) && isRecord(value.data) && Object.values(value.data).every(isRecord)
  );
}

function isOrdersEnvelope(value: unknown): value is ApiSuccessEnvelope<PublicPolyswapOrder[]> {
  return isSuccessEnvelope(value) && Array.isArray(value.data);
}

function isOrderEnvelope(value: unknown): value is ApiSuccessEnvelope<PublicPolyswapOrder> {
  return isSuccessEnvelope(value) && isRecord(value.data);
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

/** Batch lookup by slug or id; unknown identifiers are absent from the result. */
export async function getMarketsByIdentifiers(
  identifiers: string[]
): Promise<Record<string, MarketRow>> {
  const params = new URLSearchParams();
  for (const identifier of identifiers) params.append("ids", identifier);
  const response = await fetch(`${API_BASE}/markets?${params}`);
  return (await readApiResponse(response, isMarketMapEnvelope)).data;
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
): Promise<PublicPolyswapOrder[]> {
  const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
  const response = await fetch(`${API_BASE}/polyswap/orders/${ownerAddress}?${params}`);
  return (await readApiResponse(response, isOrdersEnvelope)).data;
}

/** One order as the server sees it now, bypassing any cache. Null when it no longer exists. */
export async function getOrderById(orderId: number): Promise<PublicPolyswapOrder | null> {
  const response = await fetch(`${API_BASE}/polyswap/orders/id/${orderId}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  return (await readApiResponse(response, isOrderEnvelope)).data;
}

/**
 * Server-side finalisation after ComposableCoW.remove(orderHash) has executed.
 * Unsigned: the server accepts it only when the chain shows the order removed.
 */
export async function notifyRemoveOrder(orderId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/polyswap/orders/id/${orderId}/notify-remove`, {
    method: "POST",
  });
  await readApiResponse(res, isSuccessEnvelope);
}
