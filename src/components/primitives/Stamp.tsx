import { cn } from "@/utils/cn";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function Stamp({ children, className }: Props) {
  return (
    <span
      className={cn(
        "inline-block border-2 border-accent px-2.5 py-1 text-accent",
        "text-[10px] font-bold tracking-[0.14em] uppercase",
        "-rotate-3",
        className
      )}
      style={{
        background: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
      }}
    >
      {children}
    </span>
  );
}
