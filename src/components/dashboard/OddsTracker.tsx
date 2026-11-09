import { Dial } from "@/components/charts/Dial";
import { Tape } from "@/components/charts/Tape";
import { OddsAxis } from "@/components/primitives/PageBlocks";
import { Shimmer } from "@/components/primitives/Shimmer";
import type { OrderOddsSeries } from "@/hooks/useOrderOddsSeries";
import type { OrderViewModel } from "@/hooks/orders/orderMapper";
import { fmtPct } from "@/lib/format";
import { describeTriggerDistance } from "@/lib/orderMetrics";
import { DAY_MS } from "@/lib/time";

interface Props {
  order: OrderViewModel;
  series: OrderOddsSeries;
}

export function OddsTracker({ order, series }: Props) {
  return (
    <section aria-label="Tracker" className="border border-ink bg-paper p-4 sm:p-6">
      {series.isPending ? (
        <OddsTrackerSkeleton threshold={order.threshold} />
      ) : (
        <TrackerContent order={order} series={series} />
      )}
    </section>
  );
}

function TrackerContent({ order, series }: Props) {
  const { odds, timestamps, currentOdds } = series;
  const executedAtSec = order.filledAt ? order.filledAt.getTime() / 1000 : undefined;
  const daysWaiting = Math.max(0, Math.floor((Date.now() - order.startTime.getTime()) / DAY_MS));

  return (
    <>
      <div className="flex flex-wrap items-center gap-5">
        <Dial
          current={currentOdds}
          threshold={order.threshold}
          side={order.side}
          triggerOn="drop"
          size={88}
          animate
        />
        <div className="min-w-0 flex-1">
          <p className="num text-3xl font-semibold lg:text-4xl">{fmtPct(currentOdds)}</p>
          <p className="text-sm text-ink-3">Today · trigger at {fmtPct(order.threshold)}</p>
        </div>
        <p className="num shrink-0 border border-ink bg-paper-2 px-3 py-2 text-sm">
          {describeTriggerDistance(order, currentOdds)}
        </p>
      </div>

      {/* Vertical padding on top is generous so the execution-marker
          icon (which floats above the chart top) isn't clipped by the
          outer card. We deliberately don't use overflow-hidden here. */}
      <div className="mt-5 flex gap-3 border border-rule-soft bg-paper-2 px-3 pt-7 pb-3">
        <OddsAxis />
        <div className="min-w-0 flex-1">
          <Tape
            data={odds}
            timestamps={timestamps}
            executedAt={executedAtSec}
            threshold={order.threshold}
            side={order.side}
            width={760}
            height={200}
            className="w-full"
            animate
            interactive
          />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 border border-ink">
        <Stat label="High" value={fmtPct(Math.max(...odds))} />
        <Stat label="Low" value={fmtPct(Math.min(...odds))} />
        <Stat label="Time waiting" value={`${daysWaiting}d`} />
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-ink p-3 text-center last:border-r-0 sm:p-4">
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 text-base font-semibold sm:text-lg">{value}</p>
    </div>
  );
}

/**
 * Sized to the real tracker so the swap-in causes no layout shift. The trigger
 * threshold caption is preserved (it's known from the order itself); the
 * data-dependent bits — current odds, distance label, chart, high/low —
 * shimmer until the per-market queries resolve.
 */
function OddsTrackerSkeleton({ threshold }: { threshold: number }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-5">
        <Shimmer className="h-[88px] w-[88px] rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Shimmer className="h-9 w-24" />
          <p className="text-sm text-ink-3">Today · trigger at {fmtPct(threshold)}</p>
        </div>
        <Shimmer className="h-9 w-32 shrink-0" />
      </div>

      <div className="mt-5 flex gap-3 border border-rule-soft bg-paper-2 px-3 pt-7 pb-3">
        <OddsAxis />
        <div className="min-w-0 flex-1">
          <Shimmer className="h-[200px] w-full" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 border border-ink">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-r border-ink p-3 text-center last:border-r-0 sm:p-4">
            <Shimmer className="mx-auto h-3 w-12" />
            <Shimmer className="mx-auto mt-2 h-5 w-10" />
          </div>
        ))}
      </div>
    </>
  );
}
