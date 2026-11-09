import type { Address, Hash, Hex } from "viem";

/** A single call inside a batch (matches EIP-5792 `Call` shape). */
export type SafeCall = {
  to: Address;
  data?: Hex;
  value?: bigint;
};

/** Possible high-level statuses observable by the dApp. */
export type SafeTxStatus =
  | { kind: "idle" }
  | { kind: "awaitingSignatures"; have: number; need: number }
  | { kind: "awaitingExecution" }
  | { kind: "executed"; onChainHash: Hash }
  | { kind: "reverted"; onChainHash: Hash }
  | { kind: "error"; error: Error };

/** Subset of fields we read from Safe Transaction Service REST. */
export type SafeMultisigTxResponse = {
  safe: Address;
  to: Address;
  /** Wei amount as decimal string (JSON-safe). Convert with BigInt(value) before passing to viem. */
  value: string;
  data: Hex | null;
  operation: 0 | 1;
  nonce: number;
  /** EIP-712 struct hash for the SafeTx; used to look up state via the Safe Transaction Service. */
  safeTxHash: Hash;
  executionDate: string | null;
  submissionDate: string;
  blockNumber: number | null;
  /** On-chain Ethereum transaction hash. Null until the SafeTx is executed. */
  transactionHash: Hash | null;
  isExecuted: boolean;
  isSuccessful: boolean | null;
  confirmationsRequired: number;
  readonly confirmations: ReadonlyArray<{
    readonly owner: Address;
    readonly submissionDate: string;
    readonly transactionHash: Hash | null;
    readonly signature: Hex;
    readonly signatureType: "EOA" | "CONTRACT_SIGNATURE" | "APPROVED_HASH" | "ETH_SIGN";
  }>;
};
