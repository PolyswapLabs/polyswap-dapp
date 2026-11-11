"use client";

import { useMemo, useState } from "react";
import { useOrders } from "@/hooks/useOrders";
import { useWalletModal } from "@/components/modals/WalletModalProvider";
import { PortfolioStrip } from "./PortfolioStrip";
import { StatusTabs, type DashboardTab } from "./StatusTabs";
import { SwapRow } from "./SwapRow";
import { ConnectWalletPrompt, NoSwapsYet } from "./EmptyStates";
import { MotionList, MotionItem } from "@/components/primitives/MotionList";
import { ErrorAlert } from "@/components/primitives/PageBlocks";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { AnimatePresence, motion } from "motion/react";

export function DashboardView() {
  const { orders, isLoading, isError, errorMessage, walletConnected } = useOrders();
  const wallet = useWalletModal();
  const [tab, setTab] = useState<DashboardTab>("all");

  const counts = useMemo<Record<DashboardTab, number>>(() => {
    const out: Record<DashboardTab, number> = {
      all: orders.length,
      waiting: 0,
      ready: 0,
      done: 0,
      cancelled: 0,
      expired: 0,
    };
    for (const o of orders) out[o.status]++;
    return out;
  }, [orders]);

  const filtered = tab === "all" ? orders : orders.filter((o) => o.status === tab);

  const renderSwaps = () => {
    if (!walletConnected) return <ConnectWalletPrompt onConnect={wallet.open} />;
    if (orders.length === 0) return <NoSwapsYet />;
    return (
      <div>
        <StatusTabs value={tab} onChange={setTab} counts={counts} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{
              type: "spring",
              stiffness: 320,
              damping: 36,
            }}
          >
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-3">Nothing in this tab yet.</p>
            ) : (
              <MotionList className="-mx-4 sm:mx-0">
                {filtered.map((o) => (
                  <MotionItem key={o.id}>
                    <SwapRow order={o} />
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="space-y-6 py-8 lg:space-y-8 lg:py-10">
      <header>
        <h1 className="display text-3xl leading-[1.05] sm:text-4xl lg:text-[56px]">
          Your <span className="display-italic">swaps.</span>
        </h1>
      </header>

      {walletConnected && <PortfolioStrip orders={orders} />}

      {isLoading && <DashboardSkeleton />}

      {!isLoading && isError && (
        <ErrorAlert className="px-4 py-3 text-sm">
          Couldn&rsquo;t load your swaps. {errorMessage ?? "Try again in a moment."}
        </ErrorAlert>
      )}

      {!isLoading && !isError && renderSwaps()}
    </div>
  );
}
