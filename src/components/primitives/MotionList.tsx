"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { springInVariants, staggerVariants } from "@/lib/motion";

const containerVariants = staggerVariants(0.05);
const itemVariants = springInVariants({ y: 8 }, 220);

interface ListProps {
  children: ReactNode;
  className?: string;
}

/**
 * Staggered cascade reveal. Parent + children must live in the same client
 * tree for stagger to work, so consumers pass already-rendered rows in.
 *
 * Damped spring (220/30) lands hard — no boing — to match the editorial voice.
 */
export function MotionList({ children, className }: ListProps) {
  return (
    <motion.ul className={className} variants={containerVariants} initial="hidden" animate="show">
      {children}
    </motion.ul>
  );
}

interface ItemProps {
  children: ReactNode;
  className?: string;
}

export function MotionItem({ children, className }: ItemProps) {
  return (
    <motion.li className={className} variants={itemVariants}>
      {children}
    </motion.li>
  );
}
