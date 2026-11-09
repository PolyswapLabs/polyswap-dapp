import { getAddress, type Address, type Hex } from "viem";
import { getPublicClient } from "@/backend/rpc/clients";
import { encodeSetFallbackHandlerCalldata } from "./transactionEncodingService";
import { createLogger } from "../logger";

const log = createLogger("safe-fallback");

// CoW Protocol's ExtensibleFallbackHandler on Polygon. ComposableCoW reads
// EIP-1271 signatures off the Safe through this handler — without it, every
// conditional order resolves as OrderNotValid.
const EXTENSIBLE_FALLBACK_HANDLER: Address = getAddress(
  process.env.EXTENSIBLE_FALLBACK_HANDLER ?? "0x2f55e8b20D0B9FEFA187AA7d00B6Cbe563605bF5"
);

// Safe v1.3+ stores `fallbackHandler` at this fixed slot, computed as
// `keccak256("fallback_manager.handler.address")`. Documented in the Safe
// FallbackManager source.
const FALLBACK_HANDLER_STORAGE_SLOT: Hex =
  "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";

interface SafeSetupTx {
  to: Address;
  data: Hex;
  value: string;
}

/**
 * Returns the address currently registered as the Safe's fallback handler.
 * Reads `eth_getStorageAt(safe, FALLBACK_HANDLER_STORAGE_SLOT)` — Safe stores
 * the handler in this fixed slot in v1.3+. Returns null if the address has
 * no bytecode (EOA) or storage couldn't be read.
 */
async function getCurrentFallbackHandler(safeAddress: Address): Promise<Address | null> {
  const client = getPublicClient();

  const code = await client.getCode({ address: safeAddress });
  if (!code || code === "0x") {
    // EOA — no fallback handler concept applies.
    return null;
  }

  const slot = await client.getStorageAt({
    address: safeAddress,
    slot: FALLBACK_HANDLER_STORAGE_SLOT,
  });
  if (!slot) return null;

  // Storage slot value is a 32-byte hex; the address occupies the lower 20 bytes.
  const lower20 = `0x${slot.slice(-40)}` as Hex;
  return getAddress(lower20);
}

/**
 * Builds the one-shot `setFallbackHandler` self-call needed before a Safe can
 * use ComposableCoW. Returns null when:
 *  - the address is an EOA (no contract code),
 *  - the handler is already the canonical ExtensibleFallbackHandler,
 *  - or the RPC call fails (logged; the order flow proceeds without prepending).
 *
 * The returned tx is `to: safeAddress`, i.e. a self-call. Safe Wallet
 * recognises this and wraps it in `execTransaction` automatically.
 */
export async function buildFallbackHandlerSetupTx(
  safeAddress: Address
): Promise<SafeSetupTx | null> {
  let current: Address | null;
  try {
    current = await getCurrentFallbackHandler(safeAddress);
  } catch (err) {
    log.warn(
      `failed to read fallback handler for ${safeAddress}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  if (current === null) return null;
  if (current.toLowerCase() === EXTENSIBLE_FALLBACK_HANDLER.toLowerCase()) return null;

  log.info(
    `safe ${safeAddress} fallback handler is ${current}, prepending setFallbackHandler(${EXTENSIBLE_FALLBACK_HANDLER})`
  );

  const data = encodeSetFallbackHandlerCalldata(EXTENSIBLE_FALLBACK_HANDLER);

  return {
    to: safeAddress,
    data,
    value: "0",
  };
}
