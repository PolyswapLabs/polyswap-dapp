"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.16, 1, 0.3, 1] as const; // editorial cubic-bezier

interface RevealProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  /** Pixels to translate from. Default 12. */
  offset?: number;
  /** Duration in seconds. Default 0.6. */
  duration?: number;
  /** Delay in seconds. */
  delay?: number;
  className?: string;
}

/**
 * Fade + slide-up reveal triggered when the element enters the viewport.
 * Uses Framer's IntersectionObserver under `whileInView`. Single-shot by default
 * so reveals don't replay on scroll-up.
 */
export function Reveal({
  children,
  offset = 12,
  duration = 0.6,
  delay = 0,
  className,
  ...rest
}: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: offset }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2, margin: "0px 0px -10% 0px" }}
      transition={{ duration, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

interface StackProps {
  children: ReactNode;
  /** Stagger between children in seconds. Default 0.09. */
  stagger?: number;
  /** Initial delay before the first child plays. Default 0. */
  delay?: number;
  /** Pixels to translate from. Default 14. */
  offset?: number;
  className?: string;
}

/**
 * Choreographs an immediate-on-mount cascade. Use this for hero load sequences
 * (the children animate without waiting for viewport). Children must be wrapped
 * in `<RevealItem>`.
 */
export function RevealStack({ children, stagger = 0.09, delay = 0, className }: StackProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: stagger,
            delayChildren: delay,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

interface ItemProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  offset?: number;
  duration?: number;
  className?: string;
}

export function RevealItem({
  children,
  offset = 14,
  duration = 0.6,
  className,
  ...rest
}: ItemProps) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: offset },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration, ease: EASE },
        },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
