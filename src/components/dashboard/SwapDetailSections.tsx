import type { ReactNode } from "react";
import type { Address } from "viem";
import { Icon, PolymarketIcon } from "@/components/icons";
import { Button } from "@/components/primitives/Button";
import { BackLink, DefinitionRow, ErrorAlert } from "@/components/primitives/PageBlocks";
import { Shimmer } from "@/components/primitives/Shimmer";
import { TokenLogo } from "@/components/primitives/TokenLogo";
import type { OrderViewModel } from "@/hooks/orders/orderMapper";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/utils/format";
import { polymarketEventUrl } from "@/utils/links";
import type { MarketViewModel } from "@/types/viewModels";
import { Status } from "./Status";

interface SwapHeaderProps {
  order: OrderViewModel;
  marketQuestion: string | undefined;
  isTitlePending: boolean;
  cancellable: boolean;
  cancelPending: boolean;
  cancelError: string | null;
  cancelNotice: string | null;
  onCancel: () => void;
}

export function SwapHeader({
  order,
  marketQuestion,
  isTitlePending,
  cancellable,
  cancelPending,
  cancelError,
  cancelNotice,
  onCancel,
}: SwapHeaderProps) {
  return (
    <div className="border-b border-ink pb-6 lg:pb-8">
      <BackLink href="/dashboard">Back to my swaps</BackLink>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            {isTitlePending ? (
              <Shimmer className="h-16 max-w-3xl flex-1 sm:h-20" />
            ) : (
              <h1 className="max-w-4xl font-serif text-2xl leading-tight text-balance sm:text-3xl lg:text-[40px]">
                {marketQuestion ?? order.nickname}
              </h1>
            )}
            <span className="mt-1 shrink-0">
              <Status
                kind={order.status}
                className="min-h-8 px-3 text-xs sm:min-h-9 sm:px-4 sm:text-[13px]"
              />
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-3 sm:text-sm">
            {marketQuestion ? <>{order.nickname} · </> : null}
            <span className="num">
              {formatNumber(order.sellAmount, 2)} {order.sellSymbol}
            </span>{" "}
            · expires {formatDate(order.endTime)}
          </p>
          <OrderErrorNotice order={order} />
        </div>
        {cancellable && (
          <div className="flex flex-col items-end gap-1">
            <Button variant="ink" size="md" disabled={cancelPending} onClick={onCancel}>
              <Icon.trash size={14} aria-hidden />
              {cancelPending ? "Cancelling…" : "Cancel swap"}
            </Button>
            {cancelError && <p className="text-xs text-no">{cancelError}</p>}
            {cancelNotice && (
              <p role="status" className="max-w-56 text-right text-xs text-ink-3">
                {cancelNotice}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RetryNote({ retryAt }: { retryAt: number | null }) {
  if (retryAt === null || retryAt <= Math.floor(Date.now() / 1000)) return null;
  return <> · retry around {formatDateTime(retryAt * 1000)}</>;
}

function OrderErrorNotice({ order }: { order: OrderViewModel }) {
  if (!order.lastErrorReason) return null;
  if (order.phase === "errored") {
    return <ErrorAlert className="mt-2">Errored: {order.lastErrorReason}</ErrorAlert>;
  }
  if (order.phase !== "live") return null;
  return (
    <p className="mt-2 text-xs text-ink-3">
      Waiting: {order.lastErrorReason}
      <RetryNote retryAt={order.lastErrorRetryAt} />
    </p>
  );
}

export function DealCard({ order }: { order: OrderViewModel }) {
  const isFilled = order.phase === "filled";

  return (
    <section aria-label="The deal" className="border border-ink bg-paper-2 p-5">
      <p className="eyebrow mb-3">The deal</p>
      <div className="grid grid-cols-[28px_1fr] items-center gap-x-3 gap-y-2">
        <TokenLogo symbol={order.sellSymbol} logoURI={order.sellLogoURI} size={28} />
        <span className="num text-lg">
          {isFilled
            ? formatNumber(order.actualSellAmount ?? order.sellAmount, 2)
            : formatNumber(order.sellAmount, 2)}{" "}
          {order.sellSymbol}
        </span>
        <span className="flex justify-center" aria-hidden>
          <Icon.arrowDown size={14} className="text-ink-3" />
        </span>
        <span aria-hidden />
        <TokenLogo symbol={order.buySymbol} logoURI={order.buyLogoURI} size={28} />
        <span className="num text-lg">
          {isFilled && order.actualBuyAmount !== null
            ? `${formatNumber(order.actualBuyAmount, 6)} ${order.buySymbol}`
            : order.buySymbol}
        </span>
      </div>
      {isFilled && order.actualBuyAmount !== null && order.actualSellAmount !== null && (
        <p className="mt-3 text-xs text-ink-3">
          Filled at{" "}
          <span className="num text-ink-2">
            1 {order.sellSymbol} = {formatNumber(order.actualBuyAmount / order.actualSellAmount, 6)}{" "}
            {order.buySymbol}
          </span>
        </p>
      )}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-rule-soft pt-3 text-xs">
        <DefinitionRow term="Trigger" value={`${order.side} ≃ ${formatPercent(order.threshold)}`} />
        <DefinitionRow term="Created" value={formatDate(order.startTime)} />
        <DefinitionRow term="Expires" value={formatDate(order.endTime)} />
      </dl>
    </section>
  );
}

export function MarketLinkCard({ market }: { market: MarketViewModel }) {
  return (
    <section aria-label="Market" className="border border-ink bg-paper p-5">
      <p className="eyebrow mb-3">Market</p>
      <ExternalLink href={polymarketEventUrl(market)}>
        <PolymarketIcon size={16} className="text-ink" />
        View on Polymarket
      </ExternalLink>
    </section>
  );
}

function cowOrderCaption(order: OrderViewModel): string {
  if (order.phase === "filled") {
    return "Includes the actual fill price and the on-chain settlement.";
  }
  return order.gateOpenedAt
    ? "Trigger fired — waiting on the swap to settle."
    : "Will appear here once the trigger fires and the swap settles.";
}

export function CowOrderCard({
  order,
  walletAddress,
}: {
  order: OrderViewModel;
  walletAddress: Address | undefined;
}) {
  return (
    <section aria-label="Tracking" className="border border-ink bg-paper p-5">
      <p className="eyebrow mb-3">CoW order</p>
      <CowExplorerLink order={order} walletAddress={walletAddress} />
      <p className="mt-2 text-xs text-ink-3">{cowOrderCaption(order)}</p>
    </section>
  );
}

function CowExplorerLink({
  order,
  walletAddress,
}: {
  order: OrderViewModel;
  walletAddress: Address | undefined;
}) {
  if (order.phase === "filled" && order.orderUid) {
    return (
      <ExternalLink href={`https://explorer.cow.fi/pol/orders/${order.orderUid}`}>
        View on CoW Explorer
      </ExternalLink>
    );
  }
  if (walletAddress) {
    return (
      <ExternalLink href={`https://explorer.cow.fi/pol/address/${walletAddress}`}>
        See this wallet&apos;s orders on CoW Explorer
      </ExternalLink>
    );
  }
  return (
    <p className="text-sm text-ink-3">
      Order will appear on CoW Explorer once the watch-tower picks it up.
    </p>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-2 text-sm hover:underline"
    >
      {children}
      <Icon.arrowUpRight
        size={12}
        className="text-ink-3 transition-colors group-hover:text-ink"
        aria-hidden
      />
    </a>
  );
}
