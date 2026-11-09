"use client";

import { WagmiProvider, useAccount } from "wagmi";
import { config } from "../../wagmi/config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import posthog from "posthog-js";
import { isPostHogEnabled } from "@/lib/posthog-client";

function PostHogIdentity() {
  const { address, connector, isConnected } = useAccount();
  const previousAddress = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isPostHogEnabled()) return;

    const currentAddress = isConnected && address ? address.toLowerCase() : undefined;
    if (currentAddress) {
      if (previousAddress.current && previousAddress.current !== currentAddress) {
        posthog.reset();
      }
      posthog.identify(currentAddress);
      if (connector?.id === "safe" && previousAddress.current !== currentAddress) {
        posthog.capture("wallet_connected", { connector: "safe", connection_source: "safe_app" });
      }
    } else if (previousAddress.current) {
      posthog.reset();
    }

    previousAddress.current = currentAddress;
  }, [address, connector?.id, isConnected]);

  return null;
}

export default function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <PostHogIdentity />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
