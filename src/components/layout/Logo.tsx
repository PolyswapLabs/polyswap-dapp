import Image from "next/image";
import Link from "next/link";
import { cn } from "@/utils/cn";

interface LogoProps {
  /** Rendered height in px. Width follows the SVG's natural 374:434 ratio. */
  size?: number;
  className?: string;
}

// Source SVG is 374×434 — preserve that ratio so the mark doesn't squash when
// callers pass an arbitrary size.
const NATURAL_W = 374;
const NATURAL_H = 434;

export function Logo({ size = 24, className }: LogoProps) {
  const width = Math.round((size * NATURAL_W) / NATURAL_H);
  return (
    <Image
      src="/logo/Logo_black.svg"
      alt="Polyswap"
      width={width}
      height={size}
      className={className}
      priority
    />
  );
}

interface WordmarkProps {
  logoSize?: number;
  className?: string;
  textClassName?: string;
  "aria-label"?: string;
}

/** Logo and name, linking home. */
export function Wordmark({
  logoSize = 36,
  className,
  textClassName,
  "aria-label": ariaLabel,
}: WordmarkProps) {
  return (
    <Link href="/" className={cn("flex items-center gap-3", className)} aria-label={ariaLabel}>
      <Logo size={logoSize} />
      <span className={cn("font-serif text-2xl", textClassName)}>Polyswap</span>
    </Link>
  );
}
