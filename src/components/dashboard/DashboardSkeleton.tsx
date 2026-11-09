import { Shimmer } from "@/components/primitives/Shimmer";

/**
 * Three-row skeleton sized to the real SwapRow grid so reveal causes no layout shift.
 */
export function DashboardSkeleton() {
  return (
    <ul aria-hidden className="-mx-4 sm:mx-0">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="border-b border-rule-soft px-4 py-4 sm:px-6 lg:py-5">
          <div className="grid items-center gap-4 lg:grid-cols-[60px_1fr_180px_220px_28px]">
            <Shimmer className="h-10 w-10 rounded-full lg:h-12 lg:w-12" />
            <div className="space-y-2">
              <Shimmer className="h-5 w-2/3" />
              <Shimmer className="h-3 w-1/3" />
            </div>
            <Shimmer className="hidden h-5 w-32 lg:block" />
            <Shimmer className="h-10 w-full lg:w-44" />
            <Shimmer className="hidden h-3 w-3 lg:block" />
          </div>
        </li>
      ))}
    </ul>
  );
}
