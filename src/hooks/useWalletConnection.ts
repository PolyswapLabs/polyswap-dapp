"use client";

import { useAccount, useDisconnect } from "wagmi";

interface WalletConnectionState {
  isConnected: boolean;
  address?: `0x${string}`;
  shortAddress?: string;
  disconnect: () => void;
}

function shorten(address: `0x${string}`): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Presentation-friendly view of the connected wallet. */
export function useWalletConnection(): WalletConnectionState {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  return {
    isConnected,
    address,
    shortAddress: address ? shorten(address) : undefined,
    disconnect: () => disconnect(),
  };
}
