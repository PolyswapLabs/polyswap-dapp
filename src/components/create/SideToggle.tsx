"use client";

import { cn } from "@/utils/cn";
import type { Side } from "@/shared/markets/categories";

interface Props {
  value: Side;
  onChange: (next: Side) => void;
}

export function SideToggle({ value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Trigger side" className="grid grid-cols-2 border border-ink">
      {(["YES", "NO"] as const).map((side) => {
        const active = value === side;
        return (
          <button
            key={side}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(side)}
            className={cn(
              "px-4 py-3 font-serif text-lg",
              "transition-colors",
              active
                ? side === "YES"
                  ? "bg-yes text-paper"
                  : "bg-no text-paper"
                : "bg-paper text-ink hover:bg-paper-2"
            )}
          >
            {side}
          </button>
        );
      })}
    </div>
  );
}
