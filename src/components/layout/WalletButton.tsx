"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { useWalletConnection } from "@/hooks/useWalletConnection";
import { capturePostHogEvent } from "@/lib/posthog-client";

interface Props {
  onConnect: () => void;
  className?: string;
}

/**
 * Compact wallet pill for the masthead.
 * - Disconnected: "Connect wallet" CTA → opens wallet modal (phase 5).
 * - Connected: shortened address + a hover/click affordance to disconnect.
 */
export function WalletButton({ onConnect, className }: Props) {
  const { isConnected, shortAddress, disconnect } = useWalletConnection();
  const [open, setOpen] = useState(false);

  if (!isConnected) {
    return (
      <Button variant="ink" size="sm" onClick={onConnect} className={cn("gap-2", className)}>
        <Icon.wallet size={14} aria-hidden />
        <span className="hidden sm:inline">Connect wallet</span>
        <span className="sm:hidden">Connect</span>
      </Button>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-2 border border-ink bg-paper px-3 py-1.5 text-xs",
          "num font-medium text-ink",
          "hover:bg-paper-3",
          "pointer-coarse:min-h-11"
        )}
      >
        <span aria-hidden className="inline-block size-1.5 bg-yes pulse-dot" />
        {shortAddress}
        <Icon.chevronDown size={12} aria-hidden />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute right-0 z-50 mt-2 min-w-[180px] border border-ink bg-paper",
              "shadow-[4px_4px_0_0_var(--color-ink)]"
            )}
          >
            <button
              type="button"
              onClick={() => {
                capturePostHogEvent("wallet_disconnected");
                disconnect();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-paper-3"
            >
              <Icon.x size={12} aria-hidden /> Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
