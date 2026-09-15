"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Hash } from "viem";
import { Button, Modal } from "@/components/primitives";
import { Icon } from "@/components/icons";
import { useSafeSignFlow } from "@/hooks/safe/useSafeSignFlow";
import type { SafeCall } from "@/services/safe/types";

export type SafeSignModalProps = {
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
  prepare?: {
    run: () => Promise<void>;
    heading: string;
    body: string;
  };
};

export function SafeSignModal({
  open,
  onClose,
  calls,
  onConfirmed,
  summary,
  prepare,
}: SafeSignModalProps) {
  const { state, send, reset } = useSafeSignFlow();
  // Local sub-phase tracking the optional pre-tx signing step. Kept separate
  // from useSafeSignFlow's transaction state so it can wrap around it without
  // changing the on-chain tx machine.
  const [prePhase, setPrePhase] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [prepareError, setPrepareError] = useState<string | null>(null);
  // React state is not a synchronous mutex: two clicks can observe the same
  // `prePhase` before the component renders again. Keep an imperative guard so
  // neither the off-chain signature nor the Safe transaction can be requested
  // twice.
  const actionInFlightRef = useRef(false);

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

  // On modal close: clean up state ONLY for terminal phases. Mid-flight closes
  // leave the persisted safeTxHash so a tab reload (or future modal open) can
  // resume tracking. The user's tx is still on its way.
  useEffect(() => {
    if (
      !open &&
      (state.phase === "success" ||
        state.phase === "reverted" ||
        state.phase === "replaced" ||
        state.phase === "rejected" ||
        state.phase === "error")
    ) {
      reset();
      actionInFlightRef.current = false;
      setPrePhase("idle");
      setPrepareError(null);
    }
  }, [open, state.phase, reset]);

  const startPrepare = async () => {
    if (actionInFlightRef.current) return;

    if (!prepare) {
      await startTransaction();
      return;
    }

    actionInFlightRef.current = true;
    setPrePhase("running");
    setPrepareError(null);
    try {
      await prepare.run();
      // Do not open a second wallet request while Safe is still dismissing the
      // message-signing request. A separate user action starts the transaction.
      setPrePhase("ready");
    } catch (e) {
      setPrePhase("error");
      setPrepareError(e instanceof Error ? e.message : "Failed to sign confirmation message");
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const startTransaction = async () => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    setPrePhase("idle");
    try {
      await send(calls);
    } finally {
      actionInFlightRef.current = false;
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
      <div className="p-5 sm:p-6">
        {/* idle — review screen (suppressed while a pre-tx step is running or failed) */}
        {state.phase === "idle" && prePhase === "idle" && (
          <div className="space-y-5">
            {summary && (
              <div className="border-b border-ink pb-4 font-serif text-lg italic leading-snug">
                {summary}
              </div>
            )}
            <p className="text-sm text-ink-2">
              This will send a single Safe transaction. You&rsquo;ll be asked to confirm it in your
              connected signer.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="accent" size="md" onClick={() => void startPrepare()}>
                {prepare ? "Sign authorisation" : "Approve & sign"}
                <Icon.arrowRight size={14} aria-hidden />
              </Button>
            </div>
          </div>
        )}

        {/* preparing — pre-tx signature step (optional) */}
        {prePhase === "running" && prepare && (
          <PendingScreen heading={prepare.heading} body={prepare.body} />
        )}

        {/* prepared — wait for an explicit second action before opening Safe */}
        {state.phase === "idle" && prePhase === "ready" && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <DrawnCheck />
              <div role="status" aria-live="polite">
                <p className="font-serif text-2xl">Message signed.</p>
                <p className="text-sm text-ink-2">
                  Now open Safe to approve the on-chain transaction.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="accent" size="md" onClick={() => void startTransaction()}>
                Open Safe transaction
                <Icon.arrowRight size={14} aria-hidden />
              </Button>
            </div>
          </div>
        )}

        {/* prepare error — surface and let user retry */}
        {prePhase === "error" && (
          <ErrorScreen
            heading="Couldn't sign message"
            body={prepareError ?? "Try signing the confirmation message again."}
            onClose={onClose}
            onRetry={() => void startPrepare()}
          />
        )}

        {/* wallet — waiting for signer */}
        {state.phase === "wallet" && (
          <PendingScreen
            heading="Open your Safe wallet"
            body="Confirm the transaction in Safe{Wallet} or your connected signer."
          />
        )}

        {/* proposed — submitted, Safe is preparing */}
        {state.phase === "proposed" && (
          <PendingScreen heading="Submitting…" body="Safe is preparing the transaction." />
        )}

        {/* awaitingSignatures — multi-sig waiting for co-signers */}
        {state.phase === "awaitingSignatures" && (
          <PendingScreen
            heading={`Awaiting signatures (${state.have}/${state.need})`}
            body="Other Safe owners need to sign before this can execute."
          />
        )}

        {/* awaitingExecution — signed, waiting for on-chain inclusion */}
        {state.phase === "awaitingExecution" && (
          <PendingScreen
            heading="Confirming on chain…"
            body="Your signature is in. Waiting for the network to include the transaction."
          />
        )}

        {/* success */}
        {state.phase === "success" && (
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
              href={`https://polygonscan.com/tx/${state.onChainHash}`}
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
        )}

        {/* reverted */}
        {state.phase === "reverted" && (
          <ErrorScreen
            heading="Transaction reverted"
            body="The transaction executed on chain but reverted. No funds moved."
            detail={`On-chain hash: ${state.onChainHash}`}
            onClose={onClose}
            onRetry={() => void startTransaction()}
          />
        )}

        {/* replaced */}
        {state.phase === "replaced" && (
          <ErrorScreen
            heading="Transaction replaced"
            body="A different transaction with the same Safe nonce was executed first."
            onClose={onClose}
            onRetry={() => void startTransaction()}
          />
        )}

        {/* rejected */}
        {state.phase === "rejected" && (
          <ErrorScreen
            heading="Cancelled"
            body={state.message}
            onClose={onClose}
            onRetry={() => void startTransaction()}
          />
        )}

        {/* error */}
        {state.phase === "error" && (
          <ErrorScreen
            heading="Something went wrong"
            body={state.message}
            onClose={onClose}
            onRetry={() => void startTransaction()}
          />
        )}
      </div>
    </Modal>
  );
}

// Sub-components

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
        <p className="border border-rule-soft bg-paper-2 px-3 py-2 font-mono text-xs text-ink-3 break-all">
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
