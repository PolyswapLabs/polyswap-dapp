"use client";

import { CategoryIcon } from "@/components/icons";
import { cn } from "@/utils/cn";
import { CRYPTO_RELEVANT_CATEGORIES, type MarketCategory } from "@/shared/markets/categories";

export type CategoryFilterValue = MarketCategory | "All";

const ENTRIES: ReadonlyArray<CategoryFilterValue> = ["All", ...CRYPTO_RELEVANT_CATEGORIES];

interface Props {
  value: CategoryFilterValue;
  onChange: (next: CategoryFilterValue) => void;
}

export function CategoryFilter({ value, onChange }: Props) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto border-b border-ink px-4 py-3 sm:mx-0 sm:px-0">
      {ENTRIES.map((cat) => {
        const active = value === cat;
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onChange(cat)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border border-ink px-3 py-1.5 text-sm transition-colors",
              active ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-paper-2"
            )}
            aria-pressed={active}
          >
            {cat !== "All" && <CategoryIcon category={cat} size={14} />}
            <span className="font-serif text-sm lg:text-base">{cat}</span>
          </button>
        );
      })}
    </div>
  );
}
