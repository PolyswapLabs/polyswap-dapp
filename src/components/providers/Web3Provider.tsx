"use client";

import { WagmiProvider, useAccount } from "wagmi";
import { config } from "../../wagmi/config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import posthog from "posthog-js";
import { isProductionEnvironment } from "@/lib/env";

function PostHogIdentity() {
  const { address, isConnected } = useAccount();
  const previousAddress = useRef<string | undefined>(undefined);
  const posthogProjectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  useEffect(() => {
    if (!isProductionEnvironment() || !posthogProjectToken || !posthogHost) return;

    const currentAddress = isConnected && address ? address.toLowerCase() : undefined;
    if (currentAddress) {
      if (previousAddress.current && previousAddress.current !== currentAddress) {
        posthog.reset();
      }
      posthog.identify(currentAddress);
    } else if (previousAddress.current) {
      posthog.reset();
    }

    previousAddress.current = currentAddress;
  }, [address, isConnected, posthogHost, posthogProjectToken]);

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
