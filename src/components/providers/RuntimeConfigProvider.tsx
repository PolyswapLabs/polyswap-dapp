"use client";

import { createContext, useContext } from "react";

interface RuntimeConfig {
  orderCreationDisabled: boolean;
  polymarketSentinelPostOnly: boolean;
}

const RuntimeConfigContext = createContext<RuntimeConfig>({
  orderCreationDisabled: false,
  polymarketSentinelPostOnly: true,
});

export function RuntimeConfigProvider({
  orderCreationDisabled,
  polymarketSentinelPostOnly,
  children,
}: RuntimeConfig & { children: React.ReactNode }) {
  return (
    <RuntimeConfigContext.Provider value={{ orderCreationDisabled, polymarketSentinelPostOnly }}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}
