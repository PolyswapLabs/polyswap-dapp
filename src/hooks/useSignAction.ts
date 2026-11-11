"use client";

import { useAccount, useSignMessage } from "wagmi";
import { useCallback } from "react";
import { createActionSignatureMessage } from "@/shared/orders/actionSignature";

export interface SignedAction {
  signature: string;
  timestamp: number;
  chainId: number;
}

type SignableAction = "cancel_draft";

/**
 * Hook for signing PolySwap action messages using EIP-191
 * Works with both EOA wallets and Safe wallets (via wagmi's signMessage)
 */
export function useSignAction() {
  const { chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const signAction = useCallback(
    async (action: SignableAction, orderIdentifier: string): Promise<SignedAction> => {
      if (!chainId) throw new Error("Wallet not connected");

      const timestamp = Math.floor(Date.now() / 1000);
      const message = createActionSignatureMessage(action, orderIdentifier, timestamp, chainId);
      try {
        const signature = await signMessageAsync({ message });
        return { signature, timestamp, chainId };
      } catch (err) {
        throw err instanceof Error ? err : new Error("Failed to sign message");
      }
    },
    [chainId, signMessageAsync]
  );

  return { signAction };
}
