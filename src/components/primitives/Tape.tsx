"use client";

import { useId, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { Side } from "@/types/design";

interface TapeProps {
  data: number[];
  threshold?: number;
  /** Hide the dashed threshold line (still uses `threshold` for downstream callers if drawn). */
  showThreshold?: boolean;
  side?: Side;
  width?: number;
  height?: number;
  className?: string;
  /**
   * Draw the line in once on mount via stroke-dasharray (~600ms).
   * Pure CSS — safe to render server-side. Defaults to false.
   */
  animate?: boolean;
  /** When true, show a vertical hover indicator + tooltip with value and date. */
  interactive?: boolean;
  /**
   * Per-point Unix-seconds timestamps. When provided, the hover tooltip uses
   * the actual point's date instead of the synthesised one-per-day spacing.
   */
  timestamps?: number[];
  /**
   * Unix-seconds timestamp at which the order executed. When set (and resolvable
   * to an x within the chart range via `timestamps`), draws a dashed vertical
   * line + filled dot + inline label at that point.
   */
  executedAt?: number;
}

function formatHoverDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Probability tape — sparkline with an optional threshold line and hover
 * tooltip. Always wrapped in its own viewBox so it can never bleed out.
 */
export function Tape({
  data,
  threshold = 0.7,
  showThreshold = true,
  side = "YES",
  width = 240,
  height = 56,
  className,
  animate = false,
  interactive = false,
  timestamps,
  executedAt,
}: TapeProps) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [markerHover, setMarkerHover] = useState(false);

  if (data.length < 2) {
    return null;
  }

  const padX = 2;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = innerW / (data.length - 1);

  const points = data.map((v, i) => {
    const clamped = Math.max(0, Math.min(1, v));
    return [padX + i * stepX, padY + innerH - clamped * innerH] as const;
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");
  const fillD = `${pathD} L ${width - padX} ${height - padY} L ${padX} ${height - padY} Z`;

  const yT = padY + innerH - Math.max(0, Math.min(1, threshold)) * innerH;
  const last = data[data.length - 1] ?? 0;
  const yC = padY + innerH - last * innerH;
  const xC = width - padX;

  const stroke = side === "YES" ? "var(--color-yes)" : "var(--color-no)";
  const fillCol =
    side === "YES"
      ? "color-mix(in srgb, var(--color-yes) 12%, transparent)"
      : "color-mix(in srgb, var(--color-no) 12%, transparent)";

  const onMouseMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round((xPx - padX) / stepX);
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const onMouseLeave = () => {
    if (interactive) setHover(null);
  };

  // Resolve `executedAt` to the closest data index using either the per-point
  // timestamps (preferred) or the synthesised daily spacing falling back from
  // `endDate`. If neither is available, the marker isn't drawn.
  const executedIndex: number | null = (() => {
    if (executedAt === undefined) return null;
    if (timestamps && timestamps.length === data.length) {
      let bestIdx = 0;
      let bestDelta = Math.abs(timestamps[0]! - executedAt);
      for (let i = 1; i < timestamps.length; i++) {
        const d = Math.abs(timestamps[i]! - executedAt);
        if (d < bestDelta) {
          bestDelta = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    }
    return null;
  })();
  const executedPoint = executedIndex !== null ? (points[executedIndex] ?? null) : null;
  const executedValue = executedIndex !== null ? (data[executedIndex] ?? null) : null;
  const executedDate = (() => {
    if (executedAt === undefined) return null;
    return new Date(executedAt * 1000);
  })();

  const hoverPoint = hover !== null ? (points[hover] ?? null) : null;
  const hoverValue = hover !== null ? (data[hover] ?? null) : null;
  const hoverDate = (() => {
    if (!interactive || hover === null) return null;
    if (timestamps && timestamps[hover] !== undefined) {
      return new Date(timestamps[hover]! * 1000);
    }
    return null;
  })();

  // Anchor the tooltip so it doesn't overflow the right edge.
  const tooltipX = hoverPoint ? Math.min(hoverPoint[0] + 6, width - 110) : 0;
  const tooltipY = hoverPoint ? Math.max(hoverPoint[1] - 38, 4) : 0;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn(animate && "tape-anim", className)}
      preserveAspectRatio="none"
      aria-hidden
      // overflow:visible lets the execution-marker icon escape the chart top
      // edge instead of being clipped by the SVG box.
      style={{ display: "block", maxWidth: "100%", overflow: "visible" }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path d={fillD} fill={fillCol} stroke="none" />
        {showThreshold && (
          <line
            x1={padX}
            y1={yT}
            x2={width - padX}
            y2={yT}
            stroke="var(--color-accent)"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
        )}
        <path
          d={pathD}
          fill="none"
          stroke={stroke}
          strokeWidth="1.6"
          pathLength={animate ? 1 : undefined}
        />
        <circle cx={xC} cy={yC} r="2.5" fill={stroke} />

        {hoverPoint && hoverValue !== null && !markerHover && (
          <>
            <line
              x1={hoverPoint[0]}
              y1={padY}
              x2={hoverPoint[0]}
              y2={height - padY}
              stroke="var(--color-ink)"
              strokeOpacity="0.35"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="3.5" fill={stroke} />
            <g transform={`translate(${tooltipX}, ${tooltipY})`}>
              <rect
                width="100"
                height="34"
                rx="2"
                fill="var(--color-paper)"
                stroke="var(--color-ink)"
                strokeWidth="1"
              />
              <text
                x="6"
                y="14"
                fontSize="11"
                fontFamily="var(--font-sans)"
                fill="var(--color-ink)"
                fontWeight="600"
              >
                {(hoverValue * 100).toFixed(1)}%
              </text>
              <text x="6" y="27" fontSize="10" fill="var(--color-ink-3)">
                {hoverDate ? formatHoverDate(hoverDate) : ""}
              </text>
            </g>
          </>
        )}
      </g>

      {/* Execution marker rendered OUTSIDE the clipPath so the zap icon can
          sit above the chart's top edge and the tooltip can extend past the
          chart bounds. */}
      {executedPoint && executedValue !== null && executedDate && (
        <ExecutionMarker
          x={executedPoint[0]}
          y={executedPoint[1]}
          date={executedDate}
          chartWidth={width}
          chartTop={padY}
          chartBottom={height - padY}
          hovered={markerHover}
          onHoverChange={setMarkerHover}
        />
      )}
    </svg>
  );
}

interface ExecutionMarkerProps {
  x: number;
  y: number;
  date: Date;
  chartWidth: number;
  chartTop: number;
  chartBottom: number;
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
}

const EXEC_ICON_SIZE = 14;
const EXEC_ICON_PAD = 2;
const EXEC_TOOLTIP_PAD_X = 6;
const EXEC_TOOLTIP_PAD_Y = 4;
const EXEC_TOOLTIP_FONT_PX = 10;
const EXEC_TOOLTIP_GLYPH_W = 5.4;
const EXEC_TOOLTIP_GAP = 8;

function ExecutionMarker({
  x,
  y,
  date,
  chartWidth,
  chartTop,
  chartBottom,
  hovered,
  onHoverChange,
}: ExecutionMarkerProps) {
  const iconBoxSize = EXEC_ICON_SIZE + EXEC_ICON_PAD * 2;
  const iconBoxX = x - iconBoxSize / 2;
  // Float the icon above the chart's top edge. The SVG renders with
  // overflow:visible so this isn't clipped.
  const iconBoxY = chartTop - iconBoxSize - 2;
  const lineYStart = chartTop;

  // Hover hitbox spans the icon (above the chart) plus the dashed line so the
  // user can grab anywhere on the marker.
  const hitboxW = Math.max(iconBoxSize, 14);
  const hitboxX = x - hitboxW / 2;
  const hitboxY = iconBoxY;
  const hitboxH = chartBottom - iconBoxY;

  // Tooltip text (one line each).
  const dateLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const lines = ["Executed", `${dateLabel} ${timeLabel}`];
  const longest = lines.reduce((a, b) => (a.length >= b.length ? a : b));
  const tooltipW = Math.ceil(longest.length * EXEC_TOOLTIP_GLYPH_W) + EXEC_TOOLTIP_PAD_X * 2;
  const tooltipH = EXEC_TOOLTIP_FONT_PX * lines.length + EXEC_TOOLTIP_PAD_Y * 2 + 2;
  const tooltipPreferredX = x + EXEC_TOOLTIP_GAP;
  const tooltipX =
    tooltipPreferredX + tooltipW > chartWidth ? x - EXEC_TOOLTIP_GAP - tooltipW : tooltipPreferredX;
  const tooltipY = Math.max(chartTop, Math.min(y - tooltipH / 2, chartBottom - tooltipH));

  return (
    <g>
      <line
        x1={x}
        y1={lineYStart}
        x2={x}
        y2={chartBottom}
        stroke="var(--color-ink)"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <circle
        cx={x}
        cy={y}
        r="3.5"
        fill="var(--color-accent)"
        stroke="var(--color-paper)"
        strokeWidth="1.2"
      />
      {/* Icon backdrop so the zap stays legible over the curve / threshold dash. */}
      <rect
        x={iconBoxX}
        y={iconBoxY}
        width={iconBoxSize}
        height={iconBoxSize}
        rx="2"
        fill="var(--color-paper)"
        stroke="var(--color-ink)"
        strokeWidth="1"
      />
      <g transform={`translate(${iconBoxX + EXEC_ICON_PAD}, ${iconBoxY + EXEC_ICON_PAD})`}>
        <Icon.zap size={EXEC_ICON_SIZE} className="text-accent" aria-hidden />
      </g>

      {hovered && (
        <g pointerEvents="none">
          <rect
            x={tooltipX}
            y={tooltipY}
            width={tooltipW}
            height={tooltipH}
            rx="2"
            fill="var(--color-paper)"
            stroke="var(--color-ink)"
            strokeWidth="1"
          />
          <text
            x={tooltipX + EXEC_TOOLTIP_PAD_X}
            y={tooltipY + EXEC_TOOLTIP_PAD_Y + EXEC_TOOLTIP_FONT_PX - 1}
            fontSize={EXEC_TOOLTIP_FONT_PX}
            fontFamily="var(--font-sans)"
            fontWeight="600"
            fill="var(--color-ink)"
          >
            {lines[0]}
          </text>
          <text
            x={tooltipX + EXEC_TOOLTIP_PAD_X}
            y={tooltipY + EXEC_TOOLTIP_PAD_Y + EXEC_TOOLTIP_FONT_PX * 2 + 1}
            fontSize={EXEC_TOOLTIP_FONT_PX}
            fontFamily="var(--font-sans)"
            fill="var(--color-ink-3)"
          >
            {lines[1]}
          </text>
        </g>
      )}

      {/* Hitbox last so it sits on top and captures hover. */}
      <rect
        x={hitboxX}
        y={hitboxY}
        width={hitboxW}
        height={hitboxH}
        fill="transparent"
        pointerEvents="all"
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      />
    </g>
  );
}
