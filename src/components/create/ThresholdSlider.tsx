"use client";

import { cn } from "@/utils/cn";
import { InfoTip } from "@/components/primitives/InfoTip";

interface Props {
  /** Threshold in 0..1. */
  value: number;
  onChange: (next: number) => void;
  /** Lowest live ask for the selected side, in 0..1. Drawn as a marker on the track. */
  currentPrice?: number | null;
  /** Thresholds at or above the current price would fill at once; hatch and lock them. */
  blockAtCurrentPrice?: boolean;
  /** Id of the element that explains the current value, for screen readers. */
  describedBy?: string;
  /** Quick-pick percentages, e.g. [20, 30, 50, 70, 80]. */
  picks?: number[];
}

const DEFAULT_PICKS = [20, 30, 50, 70, 80];
const MIN = 5;
const MAX = 95;
/** Native thumb is 20px wide, so its centre travels from 10px to (width - 10px). */
const THUMB_PX = 20;

/** Horizontal position of a 0..1 price on the track, aligned with the thumb centre. */
function trackPosition(price: number): string {
  const pct = Math.min(MAX, Math.max(MIN, price * 100));
  const frac = (pct - MIN) / (MAX - MIN);
  return `calc(${frac} * (100% - ${THUMB_PX}px) + ${THUMB_PX / 2}px)`;
}

export function ThresholdSlider({
  value,
  onChange,
  currentPrice = null,
  blockAtCurrentPrice = false,
  describedBy,
  picks = DEFAULT_PICKS,
}: Props) {
  const pct = Math.round(value * 100);
  const price = currentPrice !== null && currentPrice > 0 ? currentPrice : null;
  const blockedFrom = blockAtCurrentPrice ? price : null;
  const marker =
    price === null ? null : { left: trackPosition(price), pct: Math.round(price * 100) };
  // Keep the "Now" caption inside the track so it never overflows the card.
  const captionAlign =
    marker === null ? "" : marker.pct < 15 ? "left" : marker.pct > 85 ? "right" : "center";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <label
          htmlFor="threshold-range"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink"
        >
          Fire when the odds drop to
          <InfoTip
            label="How the trigger works"
            width="md"
            body="Polyswap places a BUY limit order on Polymarket at this percentage. The swap fires when the selected outcome falls to your threshold. Before signing, we check the live order book so the order can't fill straight away."
          />
        </label>
        <span className="num text-3xl font-semibold lg:text-4xl">{pct}%</span>
      </div>

      <div className={cn("relative", marker !== null ? "pb-6" : "pb-0")}>
        <div className="relative h-5">
          {/* Track */}
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden border border-ink bg-paper-3">
            {blockedFrom !== null && (
              <div
                aria-hidden
                className="absolute inset-y-0 right-0"
                style={{
                  left: trackPosition(blockedFrom),
                  backgroundImage:
                    "repeating-linear-gradient(135deg, var(--color-ink) 0 1px, transparent 1px 5px)",
                  opacity: 0.45,
                }}
              />
            )}
          </div>

          {/* Current-price marker */}
          {marker !== null && (
            <div
              aria-hidden
              className="absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-ink"
              style={{ left: marker.left }}
            />
          )}

          <input
            id="threshold-range"
            type="range"
            min={MIN}
            max={MAX}
            step={1}
            value={pct}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            aria-describedby={describedBy}
            aria-valuetext={`${pct}%`}
            className={cn(
              "absolute inset-0 h-5 w-full cursor-pointer appearance-none bg-transparent",
              "[&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent",
              // WebKit thumb
              "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-accent",
              "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ink",
              "[&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:rounded-none",
              // Firefox thumb
              "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5",
              "[&::-moz-range-thumb]:border [&::-moz-range-thumb]:bg-accent",
              "[&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:border-ink",
              "[&::-moz-range-thumb]:rounded-none"
            )}
          />
        </div>

        {marker !== null && (
          <span
            aria-hidden
            className={cn(
              "num absolute top-6 text-xs whitespace-nowrap text-ink-2",
              captionAlign === "center" && "-translate-x-1/2",
              captionAlign === "right" && "-translate-x-full"
            )}
            style={{ left: marker.left }}
          >
            Now {marker.pct}%
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {picks.map((p) => {
          const locked = blockedFrom !== null && p / 100 >= blockedFrom;
          const active = p === pct && !locked;
          return (
            <button
              key={p}
              type="button"
              disabled={locked}
              onClick={() => onChange(p / 100)}
              title={locked ? "Above the current price: this would fire immediately" : undefined}
              className={cn(
                "num border border-ink px-3 py-1 text-xs",
                active ? "bg-ink text-paper" : "bg-paper hover:bg-paper-2",
                locked && "cursor-not-allowed border-rule-soft text-ink-4 hover:bg-paper"
              )}
            >
              {p}%
            </button>
          );
        })}
      </div>
    </div>
  );
}
