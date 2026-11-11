"use client";

import { Icon } from "@/components/icons";
import { cn } from "@/utils/cn";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (next: number) => void;
}

export function Pagination({ page, pageSize, total, onChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  if (total === 0) return null;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-b border-rule-soft px-4 py-4 sm:px-6"
    >
      <p className="text-xs text-ink-3 sm:text-sm">
        <span className="num">{from}</span>–<span className="num">{to}</span> of{" "}
        <span className="num">{total.toLocaleString()}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={!canPrev}
          className={cn(
            "flex items-center gap-1 border border-ink px-3 py-1.5 text-sm transition-colors",
            canPrev ? "bg-paper hover:bg-paper-2" : "cursor-not-allowed bg-paper-2 text-ink-3"
          )}
          aria-label="Previous page"
        >
          <Icon.arrowLeft size={14} />
          <span>Prev</span>
        </button>
        <span className="num text-sm text-ink-3">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={!canNext}
          className={cn(
            "flex items-center gap-1 border border-ink px-3 py-1.5 text-sm transition-colors",
            canNext ? "bg-paper hover:bg-paper-2" : "cursor-not-allowed bg-paper-2 text-ink-3"
          )}
          aria-label="Next page"
        >
          <span>Next</span>
          <Icon.arrowRight size={14} />
        </button>
      </div>
    </nav>
  );
}
