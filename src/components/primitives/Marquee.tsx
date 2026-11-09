import { cn } from "@/lib/cn";

interface Props {
  items: string[];
  className?: string;
}

export function Marquee({ items, className }: Props) {
  const doubled = [...items, ...items];
  return (
    <div className={cn("overflow-hidden border-t border-b border-ink py-2", className)}>
      <div className="marq">
        {doubled.map((it, i) => (
          <span key={i} className="text-[12px] tracking-[0.16em] uppercase">
            {it}
            <span className="mx-6 text-ink-3" aria-hidden>
              ·
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
