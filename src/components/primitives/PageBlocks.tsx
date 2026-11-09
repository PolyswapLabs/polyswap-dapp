import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";

export function ErrorAlert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn("border border-no bg-no/10 px-3 py-2 text-xs text-no", className)}
    >
      {children}
    </div>
  );
}

/** Centered message that replaces a whole page: not found, wallet required, load error. */
export function PageMessage({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-sm text-ink-3">{children}</div>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink"
    >
      <Icon.arrowLeft size={12} aria-hidden /> {children}
    </Link>
  );
}

const ODDS_AXIS_LABELS = ["100%", "75%", "50%", "25%", "0%"];

export function OddsAxis() {
  return (
    <div className="num flex shrink-0 flex-col justify-between py-1 text-[11px] text-ink-3">
      {ODDS_AXIS_LABELS.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

/** One term and value inside a <dl>. */
export function DefinitionRow({ term, value }: { term: ReactNode; value: string }) {
  return (
    <>
      <dt className="text-ink-3">{term}</dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </>
  );
}
