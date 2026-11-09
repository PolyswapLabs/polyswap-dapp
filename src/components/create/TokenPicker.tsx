"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatUnits } from "viem";
import { TokenLogo } from "@/components/primitives";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import type { TokenViewModel } from "@/types/design";

interface Props {
  value: TokenViewModel;
  options: ReadonlyArray<TokenViewModel>;
  onChange: (next: TokenViewModel) => void;
  disabled?: boolean;
  showBalances?: boolean;
  title?: string;
}

const POPULAR_SYMBOLS = ["USDC", "USDC.e", "USDT", "DAI", "WETH", "WBTC", "WPOL", "LINK"] as const;

function formatBalance(raw: bigint, decimals: number): string {
  const num = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(num) || num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toFixed(4);
  if (num < 1_000) return num.toFixed(2);
  if (num < 1_000_000) return `${(num / 1_000).toFixed(1)}K`;
  return `${(num / 1_000_000).toFixed(2)}M`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function TokenPicker({
  value,
  options,
  onChange,
  disabled,
  showBalances = false,
  title,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const currentToken = useMemo(
    () => options.find((t) => t.address.toLowerCase() === value.address.toLowerCase()) ?? value,
    [options, value]
  );

  const { balances } = useTokenBalances(options, { enabled: open && showBalances });

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const { owned, popular, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter(
          (t) =>
            t.symbol.toLowerCase().includes(q) ||
            t.name.toLowerCase().includes(q) ||
            t.address.toLowerCase().includes(q)
        )
      : options.slice();

    const ownedList = showBalances
      ? filtered
          .filter((t) => (balances.get(t.address.toLowerCase()) ?? 0n) > 0n)
          .sort((a, b) => {
            const ba = balances.get(a.address.toLowerCase()) ?? 0n;
            const bb = balances.get(b.address.toLowerCase()) ?? 0n;
            if (bb === ba) return a.symbol.localeCompare(b.symbol);
            return bb > ba ? 1 : -1;
          })
      : [];

    const ownedAddrs = new Set(ownedList.map((t) => t.address.toLowerCase()));
    const popularList = filtered
      .filter(
        (t) =>
          POPULAR_SYMBOLS.includes(t.symbol as (typeof POPULAR_SYMBOLS)[number]) &&
          !ownedAddrs.has(t.address.toLowerCase())
      )
      .sort(
        (a, b) =>
          POPULAR_SYMBOLS.indexOf(a.symbol as (typeof POPULAR_SYMBOLS)[number]) -
          POPULAR_SYMBOLS.indexOf(b.symbol as (typeof POPULAR_SYMBOLS)[number])
      );

    const popularAddrs = new Set(popularList.map((t) => t.address.toLowerCase()));
    const restList = filtered
      .filter(
        (t) =>
          !ownedAddrs.has(t.address.toLowerCase()) && !popularAddrs.has(t.address.toLowerCase())
      )
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    return { owned: ownedList, popular: popularList, rest: restList };
  }, [options, query, balances, showBalances]);

  const totalCount = owned.length + popular.length + rest.length;

  const select = (token: TokenViewModel) => {
    onChange(token);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center justify-between gap-3 border border-ink bg-paper-2 px-3 py-2.5 text-left",
          "hover:bg-paper-3 disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        <span className="flex items-center gap-2.5">
          <TokenLogo symbol={currentToken.symbol} logoURI={currentToken.logoURI} size={28} />
          <span>
            <span className="block font-mono text-sm font-medium">{currentToken.symbol}</span>
            <span className="block text-[11px] text-ink-3">{currentToken.name}</span>
          </span>
        </span>
        <Icon.chevronDown size={14} aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-ink/60 px-4 pt-16 sm:pt-24"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title ?? "Select a token"}
            className="flex max-h-[min(640px,calc(100dvh-6rem))] w-full max-w-[460px] flex-col border border-ink bg-paper shadow-[6px_6px_0_0_var(--color-ink)]"
          >
            <div className="flex items-center justify-between border-b border-ink px-4 py-3">
              <p className="font-serif text-lg leading-none">{title ?? "Select a token"}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center text-ink-3 hover:text-ink"
              >
                <Icon.x size={16} aria-hidden />
              </button>
            </div>

            <div className="border-b border-ink px-4 py-3">
              <label className="relative block">
                <span className="sr-only">Search</span>
                <Icon.search
                  size={14}
                  aria-hidden
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
                />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, symbol, or address"
                  className="w-full border border-ink bg-paper-2 px-3 py-2 pl-8 text-sm outline-none focus:bg-paper"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {totalCount === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-ink-3">
                  {query ? <>No tokens match &ldquo;{query}&rdquo;.</> : "No tokens available."}
                </div>
              ) : (
                <>
                  {owned.length > 0 && (
                    <Section title="In your wallet">
                      {owned.map((t) => (
                        <Row
                          key={t.address}
                          token={t}
                          selected={t.address.toLowerCase() === value.address.toLowerCase()}
                          balance={balances.get(t.address.toLowerCase())}
                          onSelect={() => select(t)}
                        />
                      ))}
                    </Section>
                  )}
                  {popular.length > 0 && (
                    <Section title="Popular">
                      {popular.map((t) => (
                        <Row
                          key={t.address}
                          token={t}
                          selected={t.address.toLowerCase() === value.address.toLowerCase()}
                          balance={showBalances ? balances.get(t.address.toLowerCase()) : undefined}
                          onSelect={() => select(t)}
                        />
                      ))}
                    </Section>
                  )}
                  {rest.length > 0 && (
                    <Section title={query ? "Results" : "All tokens"}>
                      {rest.map((t) => (
                        <Row
                          key={t.address}
                          token={t}
                          selected={t.address.toLowerCase() === value.address.toLowerCase()}
                          balance={showBalances ? balances.get(t.address.toLowerCase()) : undefined}
                          onSelect={() => select(t)}
                        />
                      ))}
                    </Section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="eyebrow sticky top-0 z-10 border-b border-rule-soft bg-paper-2 px-4 py-1.5">
        {title}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function Row({
  token,
  selected,
  balance,
  onSelect,
}: {
  token: TokenViewModel;
  selected: boolean;
  balance?: bigint;
  onSelect: () => void;
}) {
  const hasPositiveBalance = balance !== undefined && balance > 0n;
  const polygonscanUrl = `https://polygonscan.com/token/${token.address}`;
  return (
    <li>
      <div
        className={cn(
          "group/row flex w-full items-stretch gap-3 border-b border-rule-soft text-sm",
          "hover:bg-paper-2",
          selected && "bg-paper-2"
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left"
        >
          <TokenLogo symbol={token.symbol} logoURI={token.logoURI} size={26} />
          <span className="min-w-0">
            <span className="block truncate font-mono font-medium">{token.symbol}</span>
            <span className="block truncate text-[11px] text-ink-3">{token.name}</span>
          </span>
        </button>
        <div className="relative flex min-w-[112px] shrink-0 items-center pr-4">
          {hasPositiveBalance && (
            <span
              aria-hidden
              className="num ml-auto text-xs transition-opacity group-hover/row:opacity-0"
            >
              {formatBalance(balance, token.decimals)}
            </span>
          )}
          <AddressLink
            href={polygonscanUrl}
            symbol={token.symbol}
            address={token.address}
            overlay={hasPositiveBalance}
          />
        </div>
      </div>
    </li>
  );
}

function AddressLink({
  href,
  symbol,
  address,
  overlay,
}: {
  href: string;
  symbol: string;
  address: string;
  overlay: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`View ${symbol} on PolygonScan`}
      aria-label={`View ${symbol} on PolygonScan`}
      className={cn(
        "num text-[10px] text-ink-3 underline-offset-2 transition-opacity hover:text-ink hover:underline",
        overlay
          ? "pointer-events-none absolute inset-y-0 right-4 flex items-center opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          : "ml-auto"
      )}
    >
      {shortAddr(address)}
    </a>
  );
}
