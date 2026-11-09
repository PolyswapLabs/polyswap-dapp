import { createActionSignatureMessage } from "@/shared/orders/actionSignature";
import {
  hashMessage,
  recoverMessageAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

const EIP1271_MAGIC_VALUE: Hex = "0x1626ba7e";
const SAFE_IS_VALID_SIGNATURE_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

interface SignatureVerificationParams {
  action: string;
  orderIdentifier: string;
  timestamp: number;
  chainId: number;
  signature: string;
  expectedAddress: string;
  publicClient: PublicClient;
}

interface VerificationResult {
  valid: boolean;
  error?: string;
}

/** Validates that a timestamp is within the acceptable signing window. */
function validateTimestamp(timestamp: number): { valid: boolean; error?: string } {
  const now = Math.floor(Date.now() / 1000);

  // Allow a small future tolerance for clock drift.
  if (timestamp > now + 60) {
    return { valid: false, error: "Timestamp is in the future" };
  }
  if (now - timestamp > MAX_TIMESTAMP_AGE_SECONDS) {
    return { valid: false, error: "Signature expired" };
  }
  return { valid: true };
}

/** Verifies an EOA signature using EIP-191 personal_sign recovery. */
async function verifyEoaSignature(
  message: string,
  signature: Hex,
  expectedAddress: Address
): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verifies a smart contract wallet signature via EIP-1271 (used by Safe and
 * other smart accounts).
 */
async function verifyEip1271Signature(
  publicClient: PublicClient,
  contractAddress: Address,
  message: string,
  signature: Hex
): Promise<boolean> {
  try {
    const digest = hashMessage(message);
    const result = await publicClient.readContract({
      address: contractAddress,
      abi: SAFE_IS_VALID_SIGNATURE_ABI,
      functionName: "isValidSignature",
      args: [digest, signature],
    });
    return result === EIP1271_MAGIC_VALUE;
  } catch {
    return false;
  }
}

/**
 * Verifies a signed PolySwap action message. Tries EOA recovery first
 * (cheapest, no RPC), then falls back to EIP-1271 for smart contract wallets
 * such as Safe. Callers must pass a viem PublicClient — see
 * getPublicClient() in rpc/clients.
 */
export async function verifySignature(
  params: SignatureVerificationParams
): Promise<VerificationResult> {
  const timestampValidation = validateTimestamp(params.timestamp);
  if (!timestampValidation.valid) {
    return { valid: false, error: timestampValidation.error };
  }

  const message = createActionSignatureMessage(
    params.action,
    params.orderIdentifier,
    params.timestamp,
    params.chainId
  );

  const signature = (
    params.signature.startsWith("0x") ? params.signature : `0x${params.signature}`
  ) as Hex;
  const expectedAddress = params.expectedAddress as Address;

  if (await verifyEoaSignature(message, signature, expectedAddress)) {
    return { valid: true };
  }
  if (await verifyEip1271Signature(params.publicClient, expectedAddress, message, signature)) {
    return { valid: true };
  }
  return { valid: false, error: "Invalid signature" };
}
