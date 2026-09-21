"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useSearchSuggestions } from "@/hooks/useMarketsData";
import { capturePostHogEvent } from "@/lib/posthog-client";

interface Props {
  value: string;
  onSubmit: (next: string) => void;
  placeholder?: string;
  className?: string;
  /** Min characters before suggestions are fetched. */
  minPrefix?: number;
  /** Debounce in ms applied to the suggestion fetch only. */
  debounceMs?: number;
}

export function SearchInputWithSuggestions({
  value,
  onSubmit,
  placeholder = "Search questions",
  className,
  minPrefix = 2,
  debounceMs = 400,
}: Props) {
  const listboxId = useId();
  const [local, setLocal] = useState(value);
  const [debouncedPrefix, setDebouncedPrefix] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local.trim().length < minPrefix) {
      setDebouncedPrefix("");
      return;
    }
    const t = setTimeout(() => setDebouncedPrefix(local.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [local, minPrefix, debounceMs]);

  const { data: suggestions = [] } = useSearchSuggestions(debouncedPrefix, open);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const submit = (next: string, method: "typed" | "suggestion" = "typed") => {
    setOpen(false);
    setHighlight(-1);
    if (next === value) return;
    if (next.trim()) {
      capturePostHogEvent("market_searched", {
        method,
        query_length: next.trim().length,
      });
    }
    onSubmit(next);
  };

  const pickSuggestion = (tag: string) => {
    setLocal(tag);
    submit(tag, "suggestion");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0 && highlight < suggestions.length) {
        pickSuggestion(suggestions[highlight]!.tag);
      } else {
        submit(local.trim());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  };

  const showDropdown = open && debouncedPrefix.length >= minPrefix && suggestions.length > 0;

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <label
        className={cn(
          "flex items-center border border-ink bg-paper-2",
          "focus-within:outline focus-within:outline-2 focus-within:outline-ink"
        )}
      >
        <span className="pl-3 text-ink-3">
          <Icon.search size={18} aria-hidden />
        </span>
        <input
          type="search"
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-transparent px-3 py-3 text-base outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
          aria-label="Search markets"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={
            showDropdown && highlight >= 0 ? `${listboxId}-${highlight}` : undefined
          }
          role="combobox"
        />
        {local.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setLocal("");
              submit("");
            }}
            className="px-3 text-ink-3 hover:text-ink"
            aria-label="Clear search"
          >
            <Icon.x size={14} />
          </button>
        )}
      </label>

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto border border-ink bg-paper shadow-lg"
        >
          {suggestions.map((s, i) => {
            const active = i === highlight;
            return (
              <li
                key={s.tag}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e: MouseEvent<HTMLLIElement>) => {
                  e.preventDefault();
                  pickSuggestion(s.tag);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between px-3 py-2 text-sm",
                  active ? "bg-ink text-paper" : "text-ink hover:bg-paper-2"
                )}
              >
                <span className="truncate font-serif">{s.tag}</span>
                <span
                  className={cn("num text-xs", active ? "text-paper opacity-70" : "text-ink-3")}
                >
                  {s.count.toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
