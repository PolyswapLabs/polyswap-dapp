"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/utils/cn";
import type { SwapStatus } from "@/types/viewModels";

export type DashboardTab = "all" | SwapStatus;

const TABS: { id: DashboardTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "ready", label: "Ready" },
  { id: "done", label: "Filled" },
  { id: "cancelled", label: "Cancelled" },
  { id: "expired", label: "Expired" },
];

interface Props {
  value: DashboardTab;
  onChange: (next: DashboardTab) => void;
  counts: Record<DashboardTab, number>;
}

export function StatusTabs({ value, onChange, counts }: Props) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      aria-label="Filter swaps by status"
      className="-mx-4 flex gap-0 overflow-x-auto border-b border-ink sm:mx-0"
    >
      {TABS.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative shrink-0 px-4 py-3 text-sm transition-colors sm:px-5",
              active ? "text-ink" : "text-ink-3 hover:text-ink"
            )}
          >
            <span className="font-medium">{tab.label}</span>
            <span className="num ml-2 text-[11px] text-ink-3">{counts[tab.id]}</span>
            {active && (
              <motion.span
                layoutId={`tab-underline-${layoutId}`}
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[2px] bg-accent"
                transition={{ type: "spring", stiffness: 400, damping: 36 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
