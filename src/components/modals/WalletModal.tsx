"use client";

import { useEffect, useMemo } from "react";
import { useConnect, type Connector } from "wagmi";
import { Modal, Button } from "@/components/primitives";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useWalletConnection } from "@/hooks/useWalletConnection";
import { capturePostHogEvent } from "@/lib/posthog-client";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called once a wallet is connected. */
  onConnected?: () => void;
}

interface ConnectorView {
  connector: Connector;
  label: string;
  blurb: string;
}

const META: Record<string, { label: string; blurb: string }> = {
  walletConnect: {
    label: "WalletConnect",
    blurb: "Scan a QR or open in your Safe wallet of choice.",
  },
};

function describe(c: Connector): { label: string; blurb: string } {
  const meta = META[c.id] ?? META[c.type];
  return meta ?? { label: c.name, blurb: "Connect with this wallet." };
}

export function WalletModal({ open, onClose, onConnected }: Props) {
  const { connect, connectors, isPending, error, variables } = useConnect();
  const { isConnected } = useWalletConnection();

  const handleConnect = (connector: Connector) => {
    const properties = { connector: connector.id };
    capturePostHogEvent("wallet_connection_attempted", properties);
    connect(
      { connector },
      {
        onSuccess: () => capturePostHogEvent("wallet_connected", properties),
        onError: (connectionError) =>
          capturePostHogEvent("wallet_connection_failed", {
            ...properties,
            error_name: connectionError.name,
          }),
      }
    );
  };

  const list = useMemo<ConnectorView[]>(
    () =>
      connectors
        // Safe auto-connects when the dApp loads inside a Safe iframe (via the
        // safe() connector's unstable_getInfoTimeout). Don't show it as a clickable
        // option outside iframe context — it would just fail.
        .filter((c) => c.id !== "safe")
        .map((c) => ({
          connector: c,
          ...describe(c),
        })),
    [connectors]
  );

  useEffect(() => {
    if (open && isConnected) {
      onConnected?.();
      onClose();
    }
  }, [open, isConnected, onConnected, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Connect a Safe wallet" size="sm">
      <div className="flex flex-col gap-3 p-5">
        <p className="border border-ink bg-paper-2 px-3 py-2.5 text-sm">
          <span className="eyebrow mr-1.5">Heads up</span>
          Polyswap currently only supports <strong>Safe wallets</strong>. Open the dapp inside the
          Safe app, or connect via WalletConnect from your Safe wallet.
        </p>

        <ul className="mt-2 flex flex-col gap-2">
          {list.map(({ connector, label, blurb }) => {
            const pending = isPending && variables?.connector === connector;
            return (
              <li key={connector.uid}>
                <button
                  type="button"
                  onClick={() => handleConnect(connector)}
                  disabled={isPending}
                  className={cn(
                    "flex w-full items-start justify-between gap-4 border border-ink bg-paper-2 px-4 py-3 text-left",
                    "hover:bg-paper-3 disabled:cursor-not-allowed disabled:opacity-60"
                  )}
                >
                  <div>
                    <p className="font-serif text-lg">{label}</p>
                    <p className="text-xs text-ink-3">{blurb}</p>
                  </div>
                  <span className="mt-1 text-ink-3" aria-hidden>
                    {pending ? (
                      <span className="num text-xs">…</span>
                    ) : (
                      <Icon.arrowRight size={16} />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {error && (
          <p className="border border-no bg-no/10 px-3 py-2 text-xs text-no">{error.message}</p>
        )}

        <Button variant="paper" size="md" onClick={onClose} className="mt-3 w-full">
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
