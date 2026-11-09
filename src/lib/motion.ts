/** The editorial ease-out shared by every entrance animation. */
export const EDITORIAL_EASE = [0.16, 1, 0.3, 1] as const;

const SPRING_DAMPING = 30;

/** Parent variants for a cascade; children animate `staggerChildren` seconds apart. */
export function staggerVariants(staggerChildren: number) {
  return {
    hidden: {},
    show: { transition: { staggerChildren } },
  } as const;
}

/** Child variants that fade in while a damped spring settles them from `from`. */
export function springInVariants(from: { x: number } | { y: number }, stiffness: number) {
  return {
    hidden: { opacity: 0, ...from },
    show: {
      opacity: 1,
      ...("x" in from ? { x: 0 } : { y: 0 }),
      transition: { type: "spring" as const, stiffness, damping: SPRING_DAMPING },
    },
  } as const;
}
