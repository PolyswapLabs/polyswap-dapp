"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";

interface Props {
  to: number;
  format: (n: number) => string;
}

/**
 * Animates a number from 0 to `to` exactly once on mount, with a damped ease.
 * No bounce, no overshoot — meant to read like a data feed loading.
 *
 * Uses `useMotionValue` + `useTransform` so the count happens outside React's
 * render cycle. The output is a readonly motion span.
 */
export function CountUp({ to, format }: Props) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, format);

  useEffect(() => {
    const controls = animate(mv, to, {
      duration: 0.36,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [mv, to]);

  return <motion.span>{display}</motion.span>;
}
