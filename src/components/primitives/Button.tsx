import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2.5",
    "border border-ink",
    "font-medium",
    "transition-[transform,box-shadow] duration-100 ease-out",
    "disabled:transform-none disabled:cursor-not-allowed disabled:opacity-40",
    "active:translate-x-0.5 active:translate-y-0.5",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink",
    "select-none",
  ],
  {
    variants: {
      variant: {
        ink: "bg-ink text-paper shadow-stamp hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-stamp-lg active:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-stamp",
        accent:
          "bg-accent text-paper shadow-stamp hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-stamp-lg active:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-stamp",
        paper: "bg-paper text-ink hover:bg-paper-3 active:translate-x-0 active:translate-y-0",
        ghost:
          "border-transparent bg-transparent text-ink underline-offset-4 hover:underline active:translate-x-0 active:translate-y-0",
      },
      size: {
        // `pointer-coarse` bumps the height to 44px on touch devices so the
        // small button still meets the iOS / Android touch-target guideline,
        // without making it visually heavy on desktop.
        sm: "px-3 py-1.5 text-xs pointer-coarse:min-h-11",
        md: "px-5 py-3 text-sm pointer-coarse:min-h-11",
        lg: "px-6 py-3.5 text-base",
      },
    },
    defaultVariants: { variant: "ink", size: "md" },
  }
);

interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...rest} />
  );
}
