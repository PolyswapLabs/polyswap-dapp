"use client";

import { motion } from "motion/react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import type { OrderViewModel } from "@/hooks/useOrders";

interface Step {
  Icon: typeof Icon.zap;
  label: string;
  caption?: string;
  state: "past" | "current" | "future";
}

function buildSteps(order: OrderViewModel): Step[] {
  const isWaiting = order.status === "waiting" || order.status === "ready";
  const isFilled = order.status === "done";
  const isCancelled = order.status === "cancelled";
  const isExpired = order.status === "expired";
  const triggerHit = order.gateOpenedAt !== null || isFilled;

  const steps: Step[] = [
    {
      Icon: Icon.plus,
      label: "You set up this swap",
      caption: fmtDateTime(order.startTime),
      state: "past",
    },
    {
      Icon: Icon.timer,
      label: "Watching the odds",
      caption:
        triggerHit && order.gateOpenedAt
          ? fmtDuration(order.gateOpenedAt.getTime() - order.startTime.getTime())
          : isWaiting
            ? "in progress"
            : isFilled
              ? "completed · duration unavailable"
              : "stopped",
      state: isWaiting && !triggerHit ? "current" : "past",
    },
  ];

  if (isExpired) {
    steps.push({
      Icon: Icon.timer,
      label: "Swap expired",
      caption: "the trigger didn't fire in time — your tokens are still in your wallet",
      state: "past",
    });
  } else if (isCancelled) {
    steps.push({
      Icon: Icon.x,
      label: "You cancelled the swap",
      caption: "your tokens are still in your wallet",
      state: "past",
    });
  } else {
    steps.push({
      Icon: Icon.zap,
      label: triggerHit ? "Trigger hit" : "Trigger not hit yet",
      caption: triggerHit
        ? order.gateOpenedAt
          ? fmtDateTime(order.gateOpenedAt)
          : "Trigger confirmed · time unavailable"
        : `when ${order.side} drops to ${Math.round(order.threshold * 100)}%`,
      state: triggerHit ? "past" : "future",
    });
    steps.push({
      Icon: Icon.check,
      label: isFilled ? "Tokens are in your wallet" : "Tokens land in your wallet",
      caption: isFilled
        ? order.filledAt
          ? fmtDateTime(order.filledAt)
          : "Settlement confirmed · time unavailable"
        : triggerHit
          ? "Settlement pending"
          : "once it fires",
      state: isFilled ? "past" : triggerHit ? "current" : "future",
    });
  }

  return steps;
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: "spring" as const, stiffness: 240, damping: 30 },
  },
} as const;

export function Timeline({ order }: { order: OrderViewModel }) {
  const steps = buildSteps(order);
  return (
    <motion.ol
      className="relative"
      aria-label="Swap timeline"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <motion.li key={i} className="relative flex gap-4 pb-6 last:pb-0" variants={itemVariants}>
            {!last && (
              <motion.span
                aria-hidden
                className={cn(
                  "absolute left-[15px] top-8 w-px origin-top",
                  step.state === "past" ? "bg-ink" : "bg-rule-soft"
                )}
                style={{ height: "calc(100% - 32px)" }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{
                  duration: 0.4,
                  delay: 0.08 * i + 0.1,
                  ease: [0.16, 1, 0.3, 1],
                }}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "z-10 inline-flex size-8 shrink-0 items-center justify-center border border-ink",
                step.state === "past" && "bg-yes text-paper",
                step.state === "current" && "bg-accent pulse-dot text-paper",
                step.state === "future" && "bg-paper text-ink-3"
              )}
            >
              <step.Icon size={14} />
            </span>
            <div>
              <p className={cn("text-sm font-medium", step.state === "future" && "text-ink-3")}>
                {step.label}
              </p>
              {step.caption && <p className="num text-xs text-ink-3">{step.caption}</p>}
            </div>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}
