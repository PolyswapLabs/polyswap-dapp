import { Icon } from "@/components/icons";

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

const ICON_SIZE = 14;
const ICON_PAD = 2;
const TOOLTIP_PAD_X = 6;
const TOOLTIP_PAD_Y = 4;
const TOOLTIP_FONT_PX = 10;
const TOOLTIP_GLYPH_W = 5.4;
const TOOLTIP_GAP = 8;

function tooltipLines(date: Date): [string, string] {
  const dateLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return ["Executed", `${dateLabel} ${timeLabel}`];
}

/** Dashed line, dot and zap icon marking the point at which an order executed. */
export function ExecutionMarker({
  x,
  y,
  date,
  chartWidth,
  chartTop,
  chartBottom,
  hovered,
  onHoverChange,
}: ExecutionMarkerProps) {
  const iconBoxSize = ICON_SIZE + ICON_PAD * 2;
  const iconBoxX = x - iconBoxSize / 2;
  // Float the icon above the chart's top edge. The SVG renders with
  // overflow:visible so this isn't clipped.
  const iconBoxY = chartTop - iconBoxSize - 2;

  // Hover hitbox spans the icon (above the chart) plus the dashed line so the
  // user can grab anywhere on the marker.
  const hitboxW = Math.max(iconBoxSize, 14);
  const hitboxX = x - hitboxW / 2;
  const hitboxH = chartBottom - iconBoxY;

  const lines = tooltipLines(date);
  const longest = lines.reduce((a, b) => (a.length >= b.length ? a : b));
  const tooltipW = Math.ceil(longest.length * TOOLTIP_GLYPH_W) + TOOLTIP_PAD_X * 2;
  const tooltipH = TOOLTIP_FONT_PX * lines.length + TOOLTIP_PAD_Y * 2 + 2;
  const tooltipPreferredX = x + TOOLTIP_GAP;
  const tooltipX =
    tooltipPreferredX + tooltipW > chartWidth ? x - TOOLTIP_GAP - tooltipW : tooltipPreferredX;
  const tooltipY = Math.max(chartTop, Math.min(y - tooltipH / 2, chartBottom - tooltipH));

  return (
    <g>
      <line
        x1={x}
        y1={chartTop}
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
      <g transform={`translate(${iconBoxX + ICON_PAD}, ${iconBoxY + ICON_PAD})`}>
        <Icon.zap size={ICON_SIZE} className="text-accent" aria-hidden />
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
            x={tooltipX + TOOLTIP_PAD_X}
            y={tooltipY + TOOLTIP_PAD_Y + TOOLTIP_FONT_PX - 1}
            fontSize={TOOLTIP_FONT_PX}
            fontFamily="var(--font-sans)"
            fontWeight="600"
            fill="var(--color-ink)"
          >
            {lines[0]}
          </text>
          <text
            x={tooltipX + TOOLTIP_PAD_X}
            y={tooltipY + TOOLTIP_PAD_Y + TOOLTIP_FONT_PX * 2 + 1}
            fontSize={TOOLTIP_FONT_PX}
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
        y={iconBoxY}
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
