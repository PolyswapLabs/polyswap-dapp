"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { DetailSkeleton } from "@/components/primitives/DetailSkeleton";
import { PageMessage } from "@/components/primitives/PageBlocks";
import { SafeSignModal } from "@/components/modals/SafeSignModal";
import { useCancelSwap } from "@/hooks/useCancelSwap";
import { useOrder } from "@/hooks/useOrders";
import { useOrderOddsSeries } from "@/hooks/useOrderOddsSeries";
import { OddsTracker } from "./OddsTracker";
import { CowOrderCard, DealCard, MarketLinkCard, SwapHeader } from "./SwapDetailSections";
import { Timeline } from "./Timeline";

interface Props {
  orderId: string;
}

export function SwapDetailPage({ orderId }: Props) {
  const { order, isLoading, isError, errorMessage, walletConnected } = useOrder(orderId);
  const { address } = useAccount();
  const series = useOrderOddsSeries(order);
  const { cancel, pending, error, modalProps } = useCancelSwap(order);

  if (!walletConnected) {
    return <PageMessage>Connect your wallet to view this swap.</PageMessage>;
  }

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (isError || !order) {
    return (
      <PageMessage>
        {isError
          ? `We couldn't load that swap. ${errorMessage ?? ""}`
          : "We couldn't find that swap."}{" "}
        <Link href="/dashboard" className="underline">
          Back to my swaps
        </Link>
        .
      </PageMessage>
    );
  }

  const { market } = series;

  return (
    <div className="space-y-8 py-8 lg:py-10">
      <SwapHeader
        order={order}
        marketQuestion={market?.question}
        isTitlePending={series.isMarketPending}
        cancellable={order.phase === "draft" || order.phase === "live"}
        cancelPending={pending}
        cancelError={error}
        onCancel={() => void cancel()}
      />

      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-8 lg:col-span-8">
          <OddsTracker order={order} series={series} />

          <section aria-label="Timeline">
            <p className="eyebrow mb-4">What&rsquo;s happened</p>
            <div className="border border-ink bg-paper p-5 lg:p-6">
              <Timeline order={order} />
            </div>
          </section>
        </div>

        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-6 lg:space-y-5">
            <DealCard order={order} />
            {market && <MarketLinkCard market={market} />}
            <CowOrderCard order={order} walletAddress={address} />
          </div>
        </aside>
      </div>

      {modalProps && <SafeSignModal {...modalProps} />}
    </div>
  );
}
