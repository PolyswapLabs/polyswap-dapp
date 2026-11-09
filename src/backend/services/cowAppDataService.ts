import { randomBytes } from "node:crypto";
import { zeroHash, bytesToHex, keccak256, toBytes, type Hex } from "viem";
import { createLogger } from "../logger";

const log = createLogger("cow-app-data");

export const DEFAULT_API_BASE = "https://api.cow.fi/polygon";
const DEFAULT_APP_CODE = "PolySwap";
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 30_000;
const APP_DATA_VERSION = "1.15.0";
const POLYSWAP_METADATA_VERSION = "1";
const MAX_FULL_APP_DATA_BYTES = 1_000;

interface CowAppDataDocument {
  version: string;
  appCode: string;
  environment: string;
  metadata: Record<string, never>;
  polyswap: {
    version: string;
    nonce: Hex;
  };
}

interface CowAppData {
  nonce: Hex;
  document: CowAppDataDocument;
  fullAppData: string;
  appDataHash: Hex;
}

export interface CowAppDataOptions {
  apiBase?: string;
  appCode?: string;
  environment?: string;
  nonce?: Hex;
  timeoutMs?: number;
}

function isBytes32(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function configuredEnvironment(): string {
  const environment = (process.env.ENVIRONMENT ?? process.env.NODE_ENV ?? "production")
    .trim()
    .toLowerCase();

  if (environment === "prod") return "production";
  if (environment === "dev" || environment === "local") return "development";
  return environment || "production";
}

function isValidTimeoutMs(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS;
}

function configuredTimeoutMs(): number {
  const parsed = Number(process.env.COW_APP_DATA_TIMEOUT_MS);
  return isValidTimeoutMs(parsed) ? parsed : DEFAULT_TIMEOUT_MS;
}

function resolveTimeoutMs(requested?: number): number {
  const timeoutMs = requested ?? configuredTimeoutMs();
  if (!isValidTimeoutMs(timeoutMs)) {
    throw new Error(
      `CoW AppData timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds`
    );
  }
  return timeoutMs;
}

/**
 * KNOWN ISSUE: CoW rate limits AppData calls (429) and offers paid access, which we don't use.
 * Orders then share this fallback, so identical orders (same owner, tokens, amounts and expiry)
 * get the same order UID and only one can execute.
 */
function configuredDefaultAppData(): Hex {
  const configured = process.env.APP_DATA?.trim();
  if (!configured) return zeroHash;
  if (!isBytes32(configured)) {
    log.warn("APP_DATA is not a bytes32 value; falling back to zero AppData");
    return zeroHash;
  }
  return configured.toLowerCase() as Hex;
}

function normalizeApiBase(value?: string): string {
  const apiBase = (value ?? process.env.COW_ORDER_BOOK_API_URL ?? DEFAULT_API_BASE)
    .trim()
    .replace(/\/+$/, "");

  if (!apiBase.startsWith("https://") && !apiBase.startsWith("http://")) {
    throw new Error("CoW Orderbook API base must be an http:// or https:// URL");
  }

  return apiBase;
}

function normalizeNonce(value?: Hex): Hex {
  if (!value) return bytesToHex(randomBytes(32));
  if (!isBytes32(value)) throw new Error("AppData nonce must be a bytes32 value");
  return value.toLowerCase() as Hex;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatBody(body: unknown): string {
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

async function putAppData(url: string, appData: CowAppData, timeoutMs: number): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullAppData: appData.fullAppData }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await responseBody(response);

  if (!response.ok) {
    throw new Error(`CoW AppData registration failed (${response.status}): ${formatBody(body)}`);
  }

  if (
    typeof body === "string" &&
    isBytes32(body) &&
    body.toLowerCase() !== appData.appDataHash.toLowerCase()
  ) {
    throw new Error(
      `CoW registered a different AppData hash: expected ${appData.appDataHash}, got ${body}`
    );
  }
}

async function confirmAppData(url: string, appData: CowAppData, timeoutMs: number): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await responseBody(response);

  if (!response.ok) {
    throw new Error(`CoW AppData confirmation failed (${response.status}): ${formatBody(body)}`);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("fullAppData" in body) ||
    body.fullAppData !== appData.fullAppData
  ) {
    throw new Error(`CoW returned unexpected AppData content: ${formatBody(body)}`);
  }

  const confirmedHash = keccak256(toBytes(body.fullAppData as string));
  if (confirmedHash.toLowerCase() !== appData.appDataHash.toLowerCase()) {
    throw new Error(
      `Confirmed AppData hashes to ${confirmedHash}, expected ${appData.appDataHash}`
    );
  }
}

/** Create the exact JSON pre-image and the bytes32 hash used in the CoW order. */
export function createCowAppData(options: CowAppDataOptions = {}): CowAppData {
  const nonce = normalizeNonce(options.nonce);
  const document: CowAppDataDocument = {
    version: APP_DATA_VERSION,
    appCode: options.appCode?.trim() || DEFAULT_APP_CODE,
    environment: options.environment?.trim() || configuredEnvironment(),
    metadata: {},
    polyswap: {
      version: POLYSWAP_METADATA_VERSION,
      nonce,
    },
  };

  const fullAppData = JSON.stringify(document);
  const byteLength = Buffer.byteLength(fullAppData, "utf8");
  if (byteLength > MAX_FULL_APP_DATA_BYTES) {
    throw new Error(`Full AppData is ${byteLength} bytes; maximum is ${MAX_FULL_APP_DATA_BYTES}`);
  }

  return {
    nonce,
    document,
    fullAppData,
    appDataHash: keccak256(toBytes(fullAppData)),
  };
}

/** Register an AppData pre-image and confirm that CoW returns the exact same content. */
export async function registerAndConfirmCowAppData(
  appData: CowAppData,
  options: CowAppDataOptions = {}
): Promise<void> {
  const apiBase = normalizeApiBase(options.apiBase);
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const url = `${apiBase}/api/v1/app_data/${appData.appDataHash}`;

  await putAppData(url, appData, timeoutMs);
  await confirmAppData(url, appData, timeoutMs);
}

/** Create, register, and confirm a unique AppData. Throws on any failure. */
async function createRegisteredCowAppData(options: CowAppDataOptions = {}): Promise<CowAppData> {
  const appData = createCowAppData(options);
  await registerAndConfirmCowAppData(appData, options);
  return appData;
}

/**
 * Return a confirmed unique hash for a new order. If registration cannot be
 * confirmed, return APP_DATA from the environment (zero by default).
 */
export async function createCowAppDataHashOrDefault(options: CowAppDataOptions = {}): Promise<Hex> {
  try {
    const appData = await createRegisteredCowAppData(options);
    log.info(`registered and confirmed AppData ${appData.appDataHash}`);
    return appData.appDataHash;
  } catch (error) {
    const fallback = configuredDefaultAppData();
    log.warn(`could not register and confirm a unique AppData; using default ${fallback}`, error);
    return fallback;
  }
}
