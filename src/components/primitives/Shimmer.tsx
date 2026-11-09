import { cn } from "@/utils/cn";

interface Props {
  className?: string;
  /**
   * The shimmer renders as a translucent ink-tinted sweep over a paper-3 base.
   * Brand-safe: no warm gradients, no glow.
   */
}

/**
 * Skeleton block with a 2s ink-sweep. Wrap in a parent that owns the size:
 *   <Shimmer className="h-4 w-32" />
 */
export function Shimmer({ className }: Props) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block overflow-hidden bg-paper-3",
        "before:absolute before:inset-0",
        "before:bg-[linear-gradient(110deg,transparent_30%,color-mix(in_srgb,var(--color-ink)_7%,transparent)_50%,transparent_70%)]",
        "before:animate-[shimmer_2s_ease-in-out_infinite]",
        className
      )}
    />
  );
}
