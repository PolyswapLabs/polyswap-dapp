"use client";

import { useAccount, useSignMessage } from "wagmi";
import { useCallback, useState } from "react";

export interface SignedAction {
  signature: string;
  timestamp: number;
  chainId: number;
}

/**
 * Hook for signing PolySwap action messages using EIP-191
 * Works with both EOA wallets and Safe wallets (via wagmi's signMessage)
 */
export function useSignAction() {
  const { chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Signs an action message for authentication
   * @param action - The action type (e.g., 'cancel_draft')
   * @param orderIdentifier - The order hash or ID
   * @returns The signature data to include in API requests
   */
  const signAction = useCallback(
    async (action: string, orderIdentifier: string): Promise<SignedAction> => {
      if (!chainId) {
        throw new Error("Wallet not connected");
      }

      setIsLoading(true);
      setError(null);

      try {
        const timestamp = Math.floor(Date.now() / 1000);

        // Create the same message format as backend expects
        const message = `PolySwap Action Request\nAction: ${action}\nOrder: ${orderIdentifier}\nTimestamp: ${timestamp}\nChain: ${chainId}`;

        // Sign the message using wagmi (works with Safe wallets too)
        const signature = await signMessageAsync({ message });

        return {
          signature,
          timestamp,
          chainId,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to sign message");
        setError(error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [chainId, signMessageAsync]
  );

  return {
    signAction,
    isLoading,
    error,
  };
}
