import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const tag = cva(
  "inline-flex items-center gap-1.5 border border-ink px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.05em] uppercase",
  {
    variants: {
      tone: {
        paper: "bg-paper text-ink",
        ink: "bg-ink text-paper",
      },
    },
    defaultVariants: { tone: "paper" },
  }
);

interface Props extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof tag> {
  children: React.ReactNode;
}

export function Tag({ tone, className, children, ...rest }: Props) {
  return (
    <span className={cn(tag({ tone }), className)} {...rest}>
      {children}
    </span>
  );
}
