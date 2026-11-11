"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { Button } from "@/components/primitives/Button";
import { Modal } from "@/components/primitives/Modal";

/** Bump the suffix to show the notice again to everyone who dismissed it. */
const DISMISSED_KEY = "polyswap:beta-notice:v1";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Storage blocked (private mode, disabled cookies): the notice simply
    // shows again next visit, which is harmless.
  }
}

/**
 * One-time welcome for the dapp's beta period. Opens after mount so the
 * server render never depends on browser storage, and stays dismissed once
 * closed through any path (button, overlay, Escape, or the feedback link).
 */
export function BetaNoticeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Reading storage must wait for mount; the server has no window.
    if (!wasDismissed()) setOpen(true);
  }, []);

  const close = useCallback(() => {
    rememberDismissal();
    setOpen(false);
  }, []);

  return (
    <Modal open={open} onClose={close} title="Welcome" size="sm">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="space-y-3 border-b border-ink pb-5 text-sm leading-6 text-ink-2">
          <p>
            Thanks for trying Polyswap this early. The app is currently in beta so start with small
            amounts.
          </p>
          <p>
            Found a bug, got confused somewhere, or have an idea? We&rsquo;d love to hear it. Your
            feedback directly shapes what we build next.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button variant="ink" className="w-full sm:flex-1" onClick={close}>
            Start exploring
          </Button>
          <TransitionLink
            href="/creators"
            onClick={close}
            className="inline-flex items-center justify-center gap-1.5 border border-ink bg-paper px-5 py-3 text-sm font-medium transition-colors hover:bg-paper-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink sm:flex-1"
          >
            Share feedback
            <Icon.arrowRight size={14} aria-hidden />
          </TransitionLink>
        </div>
      </div>
    </Modal>
  );
}
