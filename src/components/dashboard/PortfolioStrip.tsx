"use client";

import { Stamp } from "@/components/primitives/Stamp";
import type { OrderViewModel } from "@/hooks/orders/orderMapper";
import { computePortfolioMetrics } from "@/lib/orderMetrics";
import { CountUp } from "./CountUp";

interface Props {
  orders: OrderViewModel[];
}

export function PortfolioStrip({ orders }: Props) {
  const metrics = computePortfolioMetrics(orders);
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
          {m.badge && (
            <span className="absolute top-3 right-3 z-10">
              <Stamp>{m.badge}</Stamp>
            </span>
          )}
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
