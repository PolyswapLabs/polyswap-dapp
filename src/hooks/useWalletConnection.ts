"use client";

import { useAccount, useDisconnect } from "wagmi";
import { formatAddress } from "@/lib/format";

interface WalletConnectionState {
  isConnected: boolean;
  address?: `0x${string}`;
  shortAddress?: string;
  disconnect: () => void;
}

/** Presentation-friendly view of the connected wallet. */
export function useWalletConnection(): WalletConnectionState {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  return {
    isConnected,
    address,
    shortAddress: address ? formatAddress(address) : undefined,
    disconnect: () => disconnect(),
  };
}
