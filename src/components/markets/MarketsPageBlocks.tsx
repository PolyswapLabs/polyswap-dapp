import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SearchInputWithSuggestions } from "./SearchInputWithSuggestions";

export const MARKETS_PAGE_SIZE = 20;

interface MarketsPageHeaderProps {
  eyebrow: ReactNode;
  title: ReactNode;
  searchValue: string;
  onSearchSubmit: (query: string) => void;
  /** Rendered above the title row, as on the search page's back link. */
  aboveTitle?: ReactNode;
}

export function MarketsPageHeader({
  eyebrow,
  title,
  searchValue,
  onSearchSubmit,
  aboveTitle,
}: MarketsPageHeaderProps) {
  const titleRow = (
    <div
      className={cn(
        "grid items-end gap-6 lg:grid-cols-12 lg:gap-10",
        !aboveTitle && "py-10 lg:py-14"
      )}
    >
      <div className="lg:col-span-7">
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h1 className="display text-4xl leading-[0.95] sm:text-5xl lg:text-[64px]">{title}</h1>
      </div>
      <div className="lg:col-span-5">
        <SearchInputWithSuggestions
          value={searchValue}
          onSubmit={onSearchSubmit}
          placeholder="Search questions, tags, slugs"
          className="w-full"
        />
      </div>
    </div>
  );

  return (
    <div className="border-b border-ink">
      {aboveTitle ? (
        <div className="flex flex-col gap-6 py-10 lg:py-14">
          {aboveTitle}
          {titleRow}
        </div>
      ) : (
        titleRow
      )}
    </div>
  );
}

export function MarketsEmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-b border-rule-soft px-6 py-16 text-center sm:px-8 lg:py-20">
      <p className="font-serif text-xl text-ink sm:text-2xl">{title}</p>
      <p className="mt-2 text-sm text-ink-3">{hint}</p>
    </div>
  );
}
