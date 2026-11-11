"use client";

import { useEffect, useState } from "react";
import { useAccount, useCapabilities } from "wagmi";
import { polygon } from "wagmi/chains";
import type { Address } from "viem";

type SafeAccountState = {
  /** The connected Safe contract address. Undefined if not connected. */
  safeAddress: Address | undefined;
  /** True when the wallet advertises EIP-5792 atomicBatch capability. */
  supports5792: boolean;
  /** True after wagmi has finished its first connector probe. Hydration-safe. */
  isReady: boolean;
};

export function useSafeAccount(): SafeAccountState {
  const { address, status, chainId } = useAccount();

  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    // wagmi sets `status` to "reconnecting" then "connected"|"disconnected".
    // Wait until we leave the initial state to avoid SSR/CSR mismatch.
    if (status !== "reconnecting") setIsReady(true);
  }, [status]);

  const { data: capabilities } = useCapabilities({
    query: { enabled: status === "connected" },
  });

  // EIP-5792 capability detection.
  // viem 2.37+ exposes the finalized shape: { atomic: { status: 'supported' | 'ready' | 'unsupported' } }.
  // We only treat 'supported' as green-light; 'ready' may require wallet_grantPermissions first.
  // Safe Apps Provider 0.18.x still uses the pre-finalization draft: { atomicBatch: { supported: true } }.
  // Check both so we work against current Safe iframe and future wallets.
  const cap = capabilities?.[chainId ?? polygon.id];
  const atomicStatus = cap?.atomic?.status;
  const supports5792 =
    atomicStatus === "supported" ||
    Boolean((cap as { atomicBatch?: { supported?: boolean } } | undefined)?.atomicBatch?.supported);

  return {
    safeAddress: address,
    supports5792,
    isReady,
  };
}
