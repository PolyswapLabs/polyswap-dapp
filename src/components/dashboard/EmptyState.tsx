import Link from "next/link";
import { Button, buttonVariants } from "@/components/primitives";
import { Icon } from "@/components/icons";

interface Props {
  walletConnected: boolean;
  onConnect?: () => void;
}

export function EmptyState({ walletConnected, onConnect }: Props) {
  if (!walletConnected) {
    return (
      <div className="border border-ink bg-paper-2 p-10 text-center">
        <p className="font-serif text-2xl">Connect a wallet to see your swaps.</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-3">
          Polyswap is non-custodial. Your tokens stay in your wallet — connect to load and manage
          your existing swaps.
        </p>
        {onConnect && (
          <div className="mt-6 flex justify-center">
            <Button variant="ink" size="md" onClick={onConnect}>
              <Icon.wallet size={14} aria-hidden />
              Connect wallet
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="border border-ink bg-paper-2 p-10 text-center">
      <p className="font-serif text-2xl">No swaps yet.</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-3">
        Pick a Polymarket question, set your trigger, and we&rsquo;ll watch the odds for you.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href="/markets" className={buttonVariants({ variant: "accent", size: "md" })}>
          Browse markets
          <Icon.arrowRight size={14} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
