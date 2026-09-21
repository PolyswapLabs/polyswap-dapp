"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { WalletModal } from "./WalletModal";
import { capturePostHogEvent } from "@/lib/posthog-client";

interface WalletModalCtx {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const Ctx = createContext<WalletModalCtx | null>(null);

export function WalletModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => {
    if (!isOpen) capturePostHogEvent("wallet_connection_started");
    setOpen(true);
  }, [isOpen]);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletModal open={isOpen} onClose={close} />
    </Ctx.Provider>
  );
}

export function useWalletModal(): WalletModalCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useWalletModal must be used inside a WalletModalProvider (mounted by the (app) layout)."
    );
  }
  return ctx;
}
