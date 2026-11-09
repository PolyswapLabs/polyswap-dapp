"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";

interface QA {
  q: string;
  a: string;
}

const FAQS: QA[] = [
  {
    q: 'What is a "trigger"?',
    a: 'A condition you define — for example, "YES drops to 30% on the question: Will the Fed raise interest rates by 0.5% in May?". Polyswap places a BUY limit on Polymarket at your threshold; it stays pending while the price stays above your line and fires the first time the market falls to it.',
  },
  {
    q: "What if the market never reaches my line?",
    a: "Nothing happens. No funds move. The swap expires when the underlying market resolves, and your tokens stay where they were.",
  },
  {
    q: "How does it actually execute?",
    a: "Polyswap places a BUY limit order on Polymarket at your chosen percentage. The order only fills when the market's ask price drops to that level — meaning the threshold has to be set below the current price. When the limit order matches on-chain, the conditional swap executes automatically through CoW Protocol.",
  },
  {
    q: "Where does the swap price come from?",
    a: "We use CoW Protocol. When the swap executes, its intent-based mechanism ensures you get the best swap price available at that moment.",
  },
  {
    q: "What does it cost?",
    a: "There is NO fee at the moment! Subject to change — a small fee may apply on executed swaps only.",
  },
];

const EASE = [0.16, 1, 0.3, 1] as const;

export function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section id="faq" className="border-b border-ink" style={{ scrollMarginTop: "5rem" }}>
      <div className="page-container grid gap-6 py-12 lg:grid-cols-12 lg:gap-10 lg:py-20">
        <div className="lg:col-span-3">
          <p className="eyebrow mb-3">Reasonable questions</p>
          <h2 className="display text-3xl sm:text-4xl lg:text-[40px]">FAQ.</h2>
        </div>
        <div className="border-t border-ink lg:col-span-9">
          {FAQS.map((it, i) => {
            const open = openIdx === i;
            const contentId = `faq-content-${i}`;
            return (
              <div
                key={it.q}
                className={cn(
                  "border-b border-ink transition-colors duration-200",
                  open && "bg-paper-2"
                )}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={contentId}
                  onClick={() => setOpenIdx(open ? null : i)}
                  className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left lg:px-6 lg:py-5"
                >
                  <span className="font-serif text-lg sm:text-xl lg:text-[22px]">{it.q}</span>
                  <motion.span
                    aria-hidden
                    className="text-ink-3"
                    animate={{ rotate: open ? 45 : 0 }}
                    transition={{ duration: 0.24, ease: EASE }}
                  >
                    <Icon.plus size={18} />
                  </motion.span>
                </button>
                {/* Always rendered so the answers are in the server HTML; collapsed visually. */}
                <motion.div
                  id={contentId}
                  aria-hidden={!open}
                  initial={false}
                  animate={open ? "open" : "collapsed"}
                  variants={{
                    open: { height: "auto", opacity: 1 },
                    collapsed: { height: 0, opacity: 0 },
                  }}
                  transition={{
                    height: { duration: 0.32, ease: EASE },
                    opacity: { duration: 0.22, ease: EASE },
                  }}
                  style={{ overflow: "hidden" }}
                >
                  <motion.p
                    variants={{
                      open: { y: 0 },
                      collapsed: { y: -4 },
                    }}
                    transition={{ duration: 0.32, ease: EASE }}
                    className="max-w-[720px] px-5 pb-5 text-sm leading-relaxed text-ink-2 lg:px-6 lg:text-[15px]"
                  >
                    {it.a}
                  </motion.p>
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
