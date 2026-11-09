import { Icon } from "@/components/icons";

interface Props {
  /** Aria label for the question-mark button (also used as a screen-reader cue). */
  label: string;
  /** Body copy shown on hover / focus. */
  body: string;
  /** Tooltip width tier. Defaults to standard 256/288px responsive width. */
  width?: "sm" | "md";
}

/**
 * Inline help affordance: a small question-mark icon that reveals an
 * explanation on hover or keyboard focus. CSS-only — no portal — so it
 * stays inline and doesn't need layer coordination. Hover, focus-within,
 * and focus on the button all reveal the bubble.
 */
export function InfoTip({ label, body, width = "sm" }: Props) {
  const widthClass = width === "md" ? "w-72 sm:w-80" : "w-64 sm:w-72";
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center text-ink-3 hover:text-ink focus:text-ink focus:outline-none"
      >
        <Icon.helpCircle size={14} aria-hidden />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-[calc(100%+6px)] left-1/2 z-10 ${widthClass} -translate-x-1/2 border border-ink bg-paper p-3 text-left text-xs leading-relaxed text-ink opacity-0 shadow-[4px_4px_0_0_var(--color-ink)] transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100`}
      >
        {body}
      </span>
    </span>
  );
}
