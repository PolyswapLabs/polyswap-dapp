import type { OrderViewModel } from "@/hooks/orders/orderMapper";
import { fmtPointsAway, fmtRelative } from "@/lib/format";
import { DAY_MS } from "@/lib/time";

/**
 * Label beside the odds dial, in priority order: filled → trigger fired (gate
 * opened on-chain) → threshold met (market past the line, gate not yet
 * observed) → live distance to the threshold.
 *
 * Polyswap places a BUY limit at `threshold` on Polymarket, which fills only
 * when the side's price falls to that level, so the threshold is "met" when
 * the live odds drop to or below the line.
 */
export function describeTriggerDistance(
  order: Pick<OrderViewModel, "phase" | "gateOpenedAt" | "threshold">,
  odds: number
): string {
  if (order.phase === "filled") return "Filled";
  if (order.gateOpenedAt) return "Trigger fired";
  if (odds <= order.threshold) return "Threshold met";
  return `${fmtPointsAway(odds, order.threshold)} until trigger`;
}

interface BaseMetric {
  label: string;
  caption: string;
  /** Stamp text shown only when truly earned. */
  badge?: string;
}

export interface NumericMetric extends BaseMetric {
  kind: "number";
  raw: number;
  format: (n: number) => string;
}

export interface TextMetric extends BaseMetric {
  kind: "text";
  value: string;
  breathe?: boolean;
}

export type PortfolioMetric = NumericMetric | TextMetric;

export function computePortfolioMetrics(
  orders: OrderViewModel[],
  now = Date.now()
): PortfolioMetric[] {
  const filled = orders.filter((o) => o.status === "done");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const finishedTotal = filled.length + cancelled.length;
  const hitRate = finishedTotal > 0 ? filled.length / finishedTotal : null;

  // Filled-with-timestamps slice powers the time-based metrics. Some legacy
  // rows might lack `filledAt`, so we filter explicitly rather than fudge.
  const filledTimed = filled.filter(
    (o): o is OrderViewModel & { filledAt: Date } => o.filledAt !== null
  );
  const filledLast30d = filledTimed.filter((o) => now - o.filledAt.getTime() <= 30 * DAY_MS).length;

  // Average days between order creation and on-chain fill.
  const avgDays =
    filledTimed.length > 0
      ? filledTimed.reduce(
          (sum, o) => sum + (o.filledAt.getTime() - o.startTime.getTime()) / DAY_MS,
          0
        ) / filledTimed.length
      : null;

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
          value: fmtRelative(lastFill.filledAt, now),
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
      badge: hitRate === 1 && finishedTotal >= 2 ? "Perfect record" : undefined,
    },
  ];
}
