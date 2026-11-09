"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { Hash } from "viem";
import { Button } from "@/components/primitives/Button";
import { Modal } from "@/components/primitives/Modal";
import { Icon } from "@/components/icons";
import { useSafeSignModalFlow, type SafeSignPrepare } from "@/hooks/useSafeSignModalFlow";
import { polygonscanTxUrl } from "@/utils/links";
import type { SafeCall } from "@/client/safe/types";

type SafeSignModalProps = {
  open: boolean;
  onClose: () => void;
  /**
   * The calls to bundle into one Safe transaction.
   *
   * Should remain stable (same intended batch) across retries — if the parent
   * rebuilds this array on every render, memoize it with useMemo. The "Try
   * again" affordance on terminal error states re-sends this same batch.
   */
  calls: SafeCall[];
  /** Called once the transaction is confirmed on-chain. */
  onConfirmed: (onChainHash: Hash, safeTxHash: Hash) => void;
  /** Optional human-readable summary shown on the review screen. */
  summary?: React.ReactNode;
  /**
   * Optional pre-flight step run BEFORE the on-chain tx. Use this to request
   * an off-chain signature (EIP-191 / typed-data) that the caller will need
   * later — e.g. an authorisation message that must be paired with the tx
   * receipt server-side. If the promise rejects, the modal returns to the
   * review screen and surfaces the error; the tx is never sent.
   *
   * Heading/body let the caller spell out what the user is signing.
   */
  prepare?: SafeSignPrepare;
};

/** Failure screens that offer a retry. Phases without a body show the flow's own message. */
const TERMINAL_COPY = {
  prepareFailed: {
    heading: "Couldn't sign message",
    body: "Try signing the confirmation message again.",
  },
  reverted: {
    heading: "Transaction reverted",
    body: "The transaction executed on chain but reverted. No funds moved.",
  },
  rejected: { heading: "Cancelled" },
  error: { heading: "Something went wrong" },
} as const satisfies Record<string, { heading: string; body?: string }>;

export function SafeSignModal({
  open,
  onClose,
  calls,
  onConfirmed,
  summary,
  prepare,
}: SafeSignModalProps) {
  const { state, prePhase, prepareError, startPrepare, startTransaction } = useSafeSignModalFlow(
    prepare,
    calls,
    open
  );

  // Hold the latest onConfirmed in a ref so we can fire it exactly once on
  // success without putting it in the deps (which would re-run the effect on
  // every render even when nothing meaningful changed).
  const onConfirmedRef = useRef(onConfirmed);
  useLayoutEffect(() => {
    onConfirmedRef.current = onConfirmed;
  });

  useEffect(() => {
    if (state.phase === "success") {
      onConfirmedRef.current(state.onChainHash, state.safeTxHash);
    }
  }, [state]);

  const sendTransaction = () => void startTransaction();

  const renderStep = () => {
    if (prePhase === "running" && prepare) {
      return <PendingScreen heading={prepare.heading} body={prepare.body} />;
    }
    if (prePhase === "error") {
      return (
        <ErrorScreen
          heading={TERMINAL_COPY.prepareFailed.heading}
          body={prepareError ?? TERMINAL_COPY.prepareFailed.body}
          onClose={onClose}
          onRetry={() => void startPrepare()}
        />
      );
    }

    switch (state.phase) {
      case "idle":
        if (prePhase === "ready") {
          return <MessageSignedScreen onClose={onClose} onContinue={sendTransaction} />;
        }
        return prePhase === "idle" ? (
          <ReviewScreen
            summary={summary}
            continueLabel={prepare ? "Sign authorisation" : "Approve & sign"}
            onClose={onClose}
            onContinue={() => void startPrepare()}
          />
        ) : null;
      case "wallet":
        return (
          <PendingScreen
            heading="Open your Safe wallet"
            body="Confirm the transaction in Safe{Wallet} or your connected signer."
          />
        );
      case "proposed":
        return <PendingScreen heading="Submitting…" body="Safe is preparing the transaction." />;
      case "awaitingSignatures":
        return (
          <PendingScreen
            heading={`Awaiting signatures (${state.have}/${state.need})`}
            body="Other Safe owners need to sign before this can execute."
          />
        );
      case "awaitingExecution":
        return (
          <PendingScreen
            heading="Confirming on chain…"
            body="Your signature is in. Waiting for the network to include the transaction."
          />
        );
      case "success":
        return <SuccessScreen onChainHash={state.onChainHash} onClose={onClose} />;
      case "reverted":
        return (
          <ErrorScreen
            {...TERMINAL_COPY.reverted}
            detail={`On-chain hash: ${state.onChainHash}`}
            onClose={onClose}
            onRetry={sendTransaction}
          />
        );
      case "rejected":
      case "error":
        return (
          <ErrorScreen
            heading={TERMINAL_COPY[state.phase].heading}
            body={state.message}
            onClose={onClose}
            onRetry={sendTransaction}
          />
        );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirm transaction"
      size="md"
      hideClose
      staticDismiss
    >
      <div className="p-5 sm:p-6">{renderStep()}</div>
    </Modal>
  );
}

function ScreenActions({
  onClose,
  onContinue,
  continueLabel,
}: {
  onClose: () => void;
  onContinue: () => void;
  continueLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button variant="ghost" size="md" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="accent" size="md" onClick={onContinue}>
        {continueLabel}
        <Icon.arrowRight size={14} aria-hidden />
      </Button>
    </div>
  );
}

function ReviewScreen({
  summary,
  continueLabel,
  onClose,
  onContinue,
}: {
  summary: ReactNode;
  continueLabel: string;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      {summary && (
        <div className="border-b border-ink pb-4 font-serif text-lg leading-snug italic">
          {summary}
        </div>
      )}
      <p className="text-sm text-ink-2">
        This will send a single Safe transaction. You&rsquo;ll be asked to confirm it in your
        connected signer.
      </p>
      <ScreenActions onClose={onClose} onContinue={onContinue} continueLabel={continueLabel} />
    </div>
  );
}

function MessageSignedScreen({
  onClose,
  onContinue,
}: {
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <DrawnCheck />
        <div role="status" aria-live="polite">
          <p className="font-serif text-2xl">Message signed.</p>
          <p className="text-sm text-ink-2">Now open Safe to approve the on-chain transaction.</p>
        </div>
      </div>
      <ScreenActions
        onClose={onClose}
        onContinue={onContinue}
        continueLabel="Open Safe transaction"
      />
    </div>
  );
}

function SuccessScreen({ onChainHash, onClose }: { onChainHash: Hash; onClose: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <DrawnCheck />
        <div role="status" aria-live="polite">
          <p className="font-serif text-2xl">Done.</p>
        </div>
      </div>
      <p className="text-sm text-ink-2">Your transaction is on chain.</p>
      {/* TODO: derive block-explorer URL from chain config when multi-network support lands */}
      <a
        href={polygonscanTxUrl(onChainHash)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm underline underline-offset-2 hover:text-ink-2"
      >
        View on Polygonscan
        <Icon.arrowUpRight size={12} aria-hidden />
      </a>
      <div className="flex justify-end">
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function PendingScreen({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-4 py-4">
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center border border-ink bg-paper-2"
      >
        <span className="size-2 animate-pulse bg-accent" />
      </span>
      <div role="status" aria-live="polite">
        <p className="font-serif text-2xl">{heading}</p>
        <p className="text-sm text-ink-2">{body}</p>
      </div>
    </div>
  );
}

function ErrorScreen({
  heading,
  body,
  detail,
  onClose,
  onRetry,
}: {
  heading: string;
  body: string;
  detail?: string;
  onClose: () => void;
  onRetry?: () => void;
}) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex size-10 items-center justify-center border border-no bg-no/10"
        >
          <Icon.x size={18} className="text-no" aria-hidden />
        </span>
        <p className="font-serif text-2xl">{heading}</p>
      </div>
      <p className="text-sm text-ink-2">{body}</p>
      {detail && (
        <p className="border border-rule-soft bg-paper-2 px-3 py-2 font-mono text-xs break-all text-ink-3">
          {detail}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
        {onRetry && (
          <Button variant="accent" size="md" onClick={onRetry}>
            Try again
            <Icon.arrowRight size={14} aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Hand-drawn check that strokes itself in over 480ms once on mount.
 * Pure SVG SMIL — no client-only motion bundle, server-renderable.
 */
function DrawnCheck() {
  return (
    <span
      aria-hidden
      className="inline-flex size-10 items-center justify-center border border-ink bg-yes"
    >
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M5 11.5 L9.5 16 L17.5 7"
          stroke="var(--color-paper)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="1"
            to="0"
            dur="0.48s"
            begin="0.08s"
            fill="freeze"
            calcMode="spline"
            keySplines="0.16 1 0.3 1"
            keyTimes="0;1"
          />
        </path>
      </svg>
    </span>
  );
}
