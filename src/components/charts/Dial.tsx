import type { Side } from "@/types/design";

interface DialProps {
  current: number;
  threshold?: number;
  side?: Side;
  size?: number;
  className?: string;
  /** Animate the ring stroke from 0 → progress on mount (~600ms, SMIL). */
  animate?: boolean;
  /**
   * Direction the trigger fires. Polyswap places a BUY limit on Polymarket,
   * which only fills when the side's price *drops to* the threshold (the ask
   * has to fall to your bid). Pass "drop" on swap pages so the dial fills as
   * the price descends toward the line and turns accent at-or-below.
   * Pure-progress callers (market detail, summary cards) leave it as "rise".
   */
  triggerOn?: "rise" | "drop";
}

/**
 * Circular meter showing current odds vs threshold.
 * Outer ring fills as we approach threshold; turns accent when triggered.
 */
export function Dial({
  current,
  threshold = 0.7,
  side = "YES",
  size = 56,
  className,
  animate = false,
  triggerOn = "rise",
}: DialProps) {
  const r = size / 2 - 3;
  const cx = size / 2;
  const cy = size / 2;
  const c = Math.max(0, Math.min(1, current));
  const t = Math.max(0, Math.min(1, threshold));
  const triggered = triggerOn === "drop" ? c <= t : side === "YES" ? c >= t : c <= t;
  const progress =
    triggerOn === "drop"
      ? c <= t
        ? 1
        : Math.min((1 - c) / Math.max(1 - t, 0.0001), 1)
      : side === "YES"
        ? Math.min(c / Math.max(t, 0.0001), 1)
        : Math.min((1 - c) / Math.max(1 - t, 0.0001), 1);
  const strokeColor = triggered
    ? "var(--color-accent)"
    : side === "YES"
      ? "var(--color-yes)"
      : "var(--color-no)";
  const innerR = r - 2;
  const circ = 2 * Math.PI * innerR;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
      }}
    >
      <svg width={size} height={size} aria-hidden>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="var(--color-paper)"
          stroke="var(--color-ink)"
          strokeWidth="1.2"
        />
        <circle
          cx={cx}
          cy={cy}
          r={innerR}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - progress)}
          transform={`rotate(-90 ${cx} ${cy})`}
        >
          {animate && (
            <animate
              attributeName="stroke-dashoffset"
              from={circ}
              to={circ * (1 - progress)}
              dur="0.6s"
              fill="freeze"
              calcMode="spline"
              keySplines="0.16 1 0.3 1"
              keyTimes="0;1"
            />
          )}
        </circle>
      </svg>
      <span
        className="num font-semibold"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.28,
        }}
      >
        {Math.round(c * 100)}
      </span>
    </div>
  );
}
