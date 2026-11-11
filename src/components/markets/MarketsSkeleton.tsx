import { Shimmer } from "@/components/primitives/Shimmer";

/**
 * Six-row skeleton sized to the real MarketRow grid so reveal causes no layout
 * shift. Mobile and desktop slot widths intentionally match the live row.
 */
export function MarketsSkeleton() {
  return (
    <ul aria-hidden className="-mx-4 sm:mx-0">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="border-b border-rule-soft px-4 py-4 sm:px-6 lg:px-6 lg:py-5">
          <div className="grid items-center gap-4 lg:grid-cols-[28px_1fr_120px_180px_120px_64px]">
            <Shimmer className="hidden h-5 w-5 lg:block" />
            <div className="space-y-2">
              <Shimmer className="h-4 w-3/4" />
              <Shimmer className="h-3 w-1/3" />
            </div>
            <Shimmer className="hidden h-5 w-12 lg:block lg:justify-self-end" />
            <Shimmer className="h-10 w-full lg:w-44" />
            <Shimmer className="hidden h-3 w-16 lg:block lg:justify-self-end" />
            <Shimmer className="hidden h-3 w-3 lg:block" />
          </div>
        </li>
      ))}
    </ul>
  );
}
