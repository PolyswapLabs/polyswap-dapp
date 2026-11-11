"use client";

import { useId, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  areaPath,
  buildPoints,
  clampOdds,
  indexAtX,
  linePath,
  nearestIndex,
  oddsToY,
  type ChartFrame,
  type ChartPoint,
} from "@/client/chart";
import { cn } from "@/utils/cn";
import { formatDate } from "@/utils/format";
import type { Side } from "@/shared/markets/categories";
import { ExecutionMarker } from "./ExecutionMarker";

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

const PAD_X = 2;
const PAD_Y = 4;

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

  const frame: ChartFrame = { width, height, padX: PAD_X, padY: PAD_Y };
  const points = buildPoints(data, frame);
  const pathD = linePath(points);

  const thresholdY = oddsToY(clampOdds(threshold), frame);
  const lastY = oddsToY(clampOdds(data[data.length - 1] ?? 0), frame);

  const stroke = side === "YES" ? "var(--color-yes)" : "var(--color-no)";
  const fill = `color-mix(in srgb, ${stroke} 12%, transparent)`;

  const onMouseMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    setHover(indexAtX(x, frame, data.length));
  };
  const onMouseLeave = () => {
    if (interactive) setHover(null);
  };

  // The marker needs per-point timestamps to resolve `executedAt` to an x.
  const executedPoint =
    executedAt !== undefined && timestamps?.length === data.length
      ? (points[nearestIndex(timestamps, executedAt)] ?? null)
      : null;

  const hoverPoint = hover !== null ? (points[hover] ?? null) : null;
  const hoverValue = hover !== null ? (data[hover] ?? null) : null;
  const hoverSeconds = interactive && hover !== null ? timestamps?.[hover] : undefined;

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
        <path d={areaPath(pathD, frame)} fill={fill} stroke="none" />
        {showThreshold && (
          <line
            x1={PAD_X}
            y1={thresholdY}
            x2={width - PAD_X}
            y2={thresholdY}
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
        <circle cx={width - PAD_X} cy={lastY} r="2.5" fill={stroke} />

        {hoverPoint && hoverValue !== null && !markerHover && (
          <HoverOverlay
            point={hoverPoint}
            value={hoverValue}
            dateLabel={hoverSeconds !== undefined ? formatDate(hoverSeconds * 1000) : ""}
            frame={frame}
            stroke={stroke}
          />
        )}
      </g>

      {/* Execution marker rendered OUTSIDE the clipPath so the zap icon can
          sit above the chart's top edge and the tooltip can extend past the
          chart bounds. */}
      {executedPoint && executedAt !== undefined && (
        <ExecutionMarker
          x={executedPoint[0]}
          y={executedPoint[1]}
          date={new Date(executedAt * 1000)}
          chartWidth={width}
          chartTop={PAD_Y}
          chartBottom={height - PAD_Y}
          hovered={markerHover}
          onHoverChange={setMarkerHover}
        />
      )}
    </svg>
  );
}

function HoverOverlay({
  point: [x, y],
  value,
  dateLabel,
  frame,
  stroke,
}: {
  point: ChartPoint;
  value: number;
  dateLabel: string;
  frame: ChartFrame;
  stroke: string;
}) {
  // Anchor the tooltip so it doesn't overflow the right edge.
  const tooltipX = Math.min(x + 6, frame.width - 110);
  const tooltipY = Math.max(y - 38, 4);

  return (
    <>
      <line
        x1={x}
        y1={frame.padY}
        x2={x}
        y2={frame.height - frame.padY}
        stroke="var(--color-ink)"
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <circle cx={x} cy={y} r="3.5" fill={stroke} />
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
          {(value * 100).toFixed(1)}%
        </text>
        <text x="6" y="27" fontSize="10" fill="var(--color-ink-3)">
          {dateLabel}
        </text>
      </g>
    </>
  );
}
