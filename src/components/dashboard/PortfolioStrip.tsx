"use client";

import { CountUp, Stamp } from "@/components/primitives";
import type { OrderViewModel } from "@/hooks/orders/orderMapper";

interface Props {
  orders: OrderViewModel[];
}

interface BaseMetric {
  label: string;
  caption: string;
  /** Optional badge overlay (e.g. accent stamp) shown only when truly earned. */
  badge?: React.ReactNode;
}

interface NumericMetric extends BaseMetric {
  kind: "number";
  raw: number;
  format: (n: number) => string;
}

interface TextMetric extends BaseMetric {
  kind: "text";
  value: string;
  breathe?: boolean;
}

type Metric = NumericMetric | TextMetric;

const DAY_MS = 86_400_000;

function relativeFromNow(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "Just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

function compute(orders: OrderViewModel[]): Metric[] {
  const filled = orders.filter((o) => o.status === "done");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const finishedTotal = filled.length + cancelled.length;
  const hitRate = finishedTotal > 0 ? filled.length / finishedTotal : null;

  // Filled-with-timestamps slice powers the time-based metrics. Some legacy
  // rows might lack `filledAt`, so we filter explicitly rather than fudge.
  const filledTimed = filled.filter(
    (o): o is OrderViewModel & { filledAt: Date } => o.filledAt !== null
  );
  const now = Date.now();
  const filledLast30d = filledTimed.filter((o) => now - o.filledAt.getTime() <= 30 * DAY_MS).length;

  // Average days between order creation and on-chain fill.
  const avgDays =
    filledTimed.length > 0
      ? filledTimed.reduce(
          (sum, o) => sum + (o.filledAt.getTime() - o.startTime.getTime()) / DAY_MS,
          0
        ) / filledTimed.length
      : null;

  // Most recent fill — sort once, take the head.
  const lastFill =
    filledTimed.length > 0
      ? filledTimed.reduce((latest, o) => (o.filledAt > latest.filledAt ? o : latest))
      : null;

  return [
    {
      kind: "number",
      label: "Total filled",
      raw: filled.length,
      format: (n) => Math.round(n).toString(),
      caption: filled.length === 0 ? "Nothing fired yet" : `${filledLast30d} in the last 30d`,
    },
    {
      kind: "number",
      label: "Avg time to fire",
      raw: avgDays === null ? 0 : avgDays,
      format: (n) => (avgDays === null ? "—" : `${n.toFixed(1)} days`),
      caption:
        avgDays === null
          ? "No fires yet"
          : `Across ${filledTimed.length} fired ${filledTimed.length === 1 ? "swap" : "swaps"}`,
    },
    lastFill
      ? {
          kind: "text",
          label: "Last fill",
          value: relativeFromNow(lastFill.filledAt),
          caption: lastFill.nickname,
          breathe: true,
        }
      : {
          kind: "text",
          label: "Last fill",
          value: "—",
          caption: "No fires yet",
        },
    {
      kind: "number",
      label: "Hit rate",
      raw: hitRate === null ? 0 : hitRate * 100,
      format: (n) => (hitRate === null ? "—" : `${Math.round(n)}%`),
      caption: hitRate === null ? "No closed swaps yet" : `${filled.length}/${finishedTotal} fired`,
      // Only ever shown when every closed swap has fired — keeps it special.
      badge: hitRate === 1 && finishedTotal >= 2 ? <Stamp>Perfect record</Stamp> : null,
    },
  ];
}

export function PortfolioStrip({ orders }: Props) {
  const metrics = compute(orders);
  return (
    <section
      aria-label="Portfolio"
      className="grid border border-ink sm:grid-cols-2 lg:grid-cols-4"
    >
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className={`relative p-4 sm:p-5 ${
            i < metrics.length - 1
              ? "border-b border-ink lg:!border-b-0 lg:[&:not(:last-child)]:border-r sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
              : ""
          }`}
        >
          {m.badge && <span className="absolute top-3 right-3 z-10">{m.badge}</span>}
          <p className="eyebrow">{m.label}</p>
          {m.kind === "number" ? (
            <p className="num mt-2 truncate text-2xl font-semibold text-ink lg:text-3xl">
              <CountUp to={m.raw} format={m.format} />
            </p>
          ) : (
            <p
              className={`num mt-2 truncate text-2xl font-semibold text-ink lg:text-3xl ${
                m.breathe ? "breathe" : ""
              }`}
              title={m.value}
            >
              {m.value}
            </p>
          )}
          <p className="mt-1 truncate text-xs text-ink-3">{m.caption}</p>
        </div>
      ))}
    </section>
  );
}
