"use client";

import { Icon } from "@/components/icons";
import { TransitionLink } from "@/components/layout/TransitionLink";
import { Button, Modal } from "@/components/primitives";

interface Props {
  heading: string;
  body: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function UnavailableModal({ heading, body, retryLabel, onRetry }: Props) {
  return (
    <Modal
      open
      onClose={() => undefined}
      title="Polyswap unavailable"
      size="sm"
      hideClose
      staticDismiss
      panelClassName="shadow-stamp-lg"
    >
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span
            className="flex size-11 shrink-0 items-center justify-center border border-ink bg-paper-2"
            aria-hidden
          >
            <Icon.lock size={20} />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 className="font-serif text-3xl leading-[0.98] tracking-[-0.02em]">{heading}</h2>
          </div>
        </div>

        <div className="border-y border-ink py-4 text-sm leading-6 text-ink-2">
          <p>{body}</p>
        </div>

        <div className="flex flex-col gap-3">
          <TransitionLink
            href="/"
            className="inline-flex items-center justify-center border border-ink bg-paper px-5 py-3 text-sm font-medium transition-colors hover:bg-paper-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
          >
            Back to home
          </TransitionLink>
          {retryLabel && onRetry && (
            <Button variant="ink" className="w-full" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
