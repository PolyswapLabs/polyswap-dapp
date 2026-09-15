import { randomBytes } from "node:crypto";
import { bytesToHex, keccak256, toBytes, type Hex } from "viem";
import { createLogger } from "../logger";

const log = createLogger("cow-app-data");

const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_API_BASE = "https://api.cow.fi/polygon";
const DEFAULT_APP_CODE = "PolySwap";
const DEFAULT_TIMEOUT_MS = 5_000;
const APP_DATA_VERSION = "1.15.0";
const POLYSWAP_METADATA_VERSION = "1";
const MAX_FULL_APP_DATA_BYTES = 1_000;

export interface CowAppDataDocument {
  version: string;
  appCode: string;
  environment: string;
  metadata: Record<string, never>;
  polyswap: {
    version: string;
    nonce: Hex;
  };
}

export interface CowAppData {
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

function configuredTimeoutMs(): number {
  const parsed = Number(process.env.COW_APP_DATA_TIMEOUT_MS);
  if (Number.isInteger(parsed) && parsed >= 250 && parsed <= 30_000) return parsed;
  return DEFAULT_TIMEOUT_MS;
}

function configuredDefaultAppData(): Hex {
  const configured = process.env.APP_DATA?.trim();
  if (!configured) return ZERO_BYTES32;
  if (!isBytes32(configured)) {
    log.warn("APP_DATA is not a bytes32 value; falling back to zero AppData");
    return ZERO_BYTES32;
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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

export class CowAppDataService {
  /** Create the exact JSON pre-image and the bytes32 hash used in the CoW order. */
  static create(options: CowAppDataOptions = {}): CowAppData {
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
  static async registerAndConfirm(
    appData: CowAppData,
    options: CowAppDataOptions = {}
  ): Promise<void> {
    const apiBase = normalizeApiBase(options.apiBase);
    const timeoutMs = options.timeoutMs ?? configuredTimeoutMs();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) {
      throw new Error("CoW AppData timeout must be between 250 and 30000 milliseconds");
    }

    const url = `${apiBase}/api/v1/app_data/${appData.appDataHash}`;
    const registration = await fetchWithTimeout(
      url,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullAppData: appData.fullAppData }),
      },
      timeoutMs
    );
    const registrationBody = await responseBody(registration);

    if (!registration.ok) {
      throw new Error(
        `CoW AppData registration failed (${registration.status}): ${formatBody(registrationBody)}`
      );
    }

    if (
      typeof registrationBody === "string" &&
      isBytes32(registrationBody) &&
      registrationBody.toLowerCase() !== appData.appDataHash.toLowerCase()
    ) {
      throw new Error(
        `CoW registered a different AppData hash: expected ${appData.appDataHash}, got ${registrationBody}`
      );
    }

    const confirmation = await fetchWithTimeout(url, undefined, timeoutMs);
    const confirmationBody = await responseBody(confirmation);
    if (!confirmation.ok) {
      throw new Error(
        `CoW AppData confirmation failed (${confirmation.status}): ${formatBody(confirmationBody)}`
      );
    }

    if (
      !confirmationBody ||
      typeof confirmationBody !== "object" ||
      !("fullAppData" in confirmationBody) ||
      confirmationBody.fullAppData !== appData.fullAppData
    ) {
      throw new Error(`CoW returned unexpected AppData content: ${formatBody(confirmationBody)}`);
    }

    const confirmedHash = keccak256(toBytes(confirmationBody.fullAppData as string));
    if (confirmedHash.toLowerCase() !== appData.appDataHash.toLowerCase()) {
      throw new Error(
        `Confirmed AppData hashes to ${confirmedHash}, expected ${appData.appDataHash}`
      );
    }
  }

  /** Create, register, and confirm a unique AppData. Throws on any failure. */
  static async createRegistered(options: CowAppDataOptions = {}): Promise<CowAppData> {
    const appData = this.create(options);
    await this.registerAndConfirm(appData, options);
    return appData;
  }

  /**
   * Return a confirmed unique hash for a new order. If registration cannot be
   * confirmed, return APP_DATA from the environment (zero by default).
   */
  static async createHashOrDefault(options: CowAppDataOptions = {}): Promise<Hex> {
    try {
      const appData = await this.createRegistered(options);
      log.info(`registered and confirmed AppData ${appData.appDataHash}`);
      return appData.appDataHash;
    } catch (error) {
      const fallback = configuredDefaultAppData();
      log.warn(`could not register and confirm a unique AppData; using default ${fallback}`, error);
      return fallback;
    }
  }
}

export default CowAppDataService;
