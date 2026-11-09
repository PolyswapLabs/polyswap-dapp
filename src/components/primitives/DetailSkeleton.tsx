import { Shimmer } from "./Shimmer";

/**
 * Placeholder for any detail-style page (market detail, swap detail, create
 * page) — a top header strip plus an 8/4 grid skeleton. Sized to roughly
 * match the real layout so the data swap-in causes no layout shift.
 */
export function DetailSkeleton() {
  return (
    <div className="space-y-8 py-8 lg:py-10">
      <div className="border-b border-ink pb-6 lg:pb-8">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="mt-3 h-8 w-3/4 sm:h-10 lg:h-11" />
        <Shimmer className="mt-2 h-3 w-1/3" />
      </div>
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-8">
          <Shimmer className="h-24 w-full" />
          <Shimmer className="h-56 w-full" />
          <Shimmer className="h-20 w-full" />
        </div>
        <aside className="lg:col-span-4">
          <div className="space-y-4">
            <Shimmer className="h-40 w-full" />
            <Shimmer className="h-24 w-full" />
          </div>
        </aside>
      </div>
    </div>
  );
}
