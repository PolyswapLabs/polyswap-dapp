import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import type { SwapStatus } from "@/types/design";

const status = cva(
  "inline-flex min-h-6 items-center gap-1.5 border border-ink px-2.5 py-1 text-[11px] leading-none font-semibold tracking-[0.1em]",
  {
    variants: {
      kind: {
        waiting: "bg-paper text-ink",
        ready: "bg-accent text-paper",
        done: "bg-yes text-paper",
        cancelled: "bg-paper-3 text-ink-3",
        expired: "bg-paper-3 text-ink-3",
      },
    },
    defaultVariants: { kind: "waiting" },
  }
);

const dotColor: Record<SwapStatus, string | null> = {
  waiting: "bg-warn",
  ready: "bg-paper",
  done: null,
  cancelled: null,
  expired: null,
};

const label: Record<SwapStatus, string> = {
  waiting: "WAITING",
  ready: "READY",
  done: "FILLED",
  cancelled: "CANCELLED",
  expired: "EXPIRED",
};

interface Props extends VariantProps<typeof status> {
  kind: SwapStatus;
  className?: string;
}

export function Status({ kind, className }: Props) {
  const dot = dotColor[kind];
  return (
    <span className={cn(status({ kind }), className)}>
      {dot && <span className={cn("inline-block h-1.5 w-1.5 pulse-dot", dot)} aria-hidden />}
      {label[kind]}
    </span>
  );
}
