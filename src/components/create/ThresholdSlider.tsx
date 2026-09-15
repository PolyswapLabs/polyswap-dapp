"use client";

import { cn } from "@/lib/cn";
import { InfoTip } from "@/components/primitives/InfoTip";

interface Props {
  /** Threshold in 0..1. */
  value: number;
  onChange: (next: number) => void;
  /** Quick-pick percentages, e.g. [50, 60, 70, 80, 90]. */
  picks?: number[];
}

const DEFAULT_PICKS = [50, 60, 70, 80, 90];

export function ThresholdSlider({ value, onChange, picks = DEFAULT_PICKS }: Props) {
  const pct = Math.round(value * 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow inline-flex items-center gap-1.5">
          Trigger threshold
          <InfoTip
            label="How the trigger works"
            width="md"
            body="Polyswap places a BUY limit order on Polymarket at this percentage. The order waits until the selected outcome reaches your threshold. Before signing, we verify the live order book to make sure the order would not execute immediately."
          />
        </span>
        <span className="num text-3xl font-semibold lg:text-4xl">{pct}%</span>
      </div>

      <input
        type="range"
        min={5}
        max={95}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label="Threshold percentage"
        className={cn(
          "h-2 w-full appearance-none bg-paper-3",
          "border border-ink",
          // WebKit thumb
          "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5",
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-accent",
          "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ink",
          "[&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:rounded-none",
          // Firefox thumb
          "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5",
          "[&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border",
          "[&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:cursor-grab",
          "[&::-moz-range-thumb]:rounded-none"
        )}
      />

      <div className="flex flex-wrap gap-2">
        {picks.map((p) => {
          const active = p === pct;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p / 100)}
              className={cn(
                "num border border-ink px-3 py-1 text-xs",
                active ? "bg-ink text-paper" : "bg-paper hover:bg-paper-2"
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
