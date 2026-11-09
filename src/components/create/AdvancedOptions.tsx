"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/primitives/InfoTip";
import { cn } from "@/utils/cn";
import { EXPIRY_OPTIONS } from "@/client/orders/createOrder";
import type { CreateFormState } from "@/hooks/useCreateOrderForm";

interface Props {
  state: Pick<CreateFormState, "expiry" | "slippagePct">;
  onChange: <K extends "expiry" | "slippagePct">(key: K, value: CreateFormState[K]) => void;
}

type SlippageOption = { value: "auto" | number; label: string };
const SLIPPAGE_OPTIONS: SlippageOption[] = [
  { value: "auto", label: "Auto" },
  { value: 0.5, label: "0.5%" },
  { value: 1, label: "1%" },
  { value: 2, label: "2%" },
  { value: 5, label: "5%" },
];

export function AdvancedOptions({ state, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border border-ink bg-paper">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm sm:px-5"
        aria-expanded={open}
      >
        <span className="eyebrow">A few extra options</span>
        <span className={cn("text-ink-3 transition-transform", open && "rotate-180")} aria-hidden>
          <Icon.chevronDown size={14} />
        </span>
      </button>
      {open && (
        <div className="space-y-5 border-t border-rule-soft p-4 sm:p-5">
          <div>
            <p className="text-xs text-ink-3">Cancel automatically after</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXPIRY_OPTIONS.map((e) => {
                const active = state.expiry === e.value;
                return (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => onChange("expiry", e.value)}
                    className={cn(
                      "border border-ink px-3 py-1.5 text-xs",
                      active ? "bg-ink text-paper" : "bg-paper hover:bg-paper-2"
                    )}
                  >
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs text-ink-3">
              How much price wiggle is OK
              <InfoTip
                label="What does price wiggle mean?"
                body="Auto lets the CoW solver pick the best executable price at fill time, with no minimum floor. A percentage caps the slippage: if the live price would give you less than the estimation minus choosen wiggle %, the swap waits until the price recovers or the order expires."
                width="md"
              />
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SLIPPAGE_OPTIONS.map((opt) => {
                const active =
                  opt.value === "auto"
                    ? state.slippagePct === "auto"
                    : typeof state.slippagePct === "number" &&
                      Math.abs(state.slippagePct - opt.value) < 0.001;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onChange("slippagePct", opt.value)}
                    className={cn(
                      "num border border-ink px-3 py-1.5 text-xs",
                      active ? "bg-ink text-paper" : "bg-paper hover:bg-paper-2"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
