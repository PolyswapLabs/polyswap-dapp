"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { Wordmark } from "./Logo";
import { WalletButton } from "./WalletButton";
import { MobileNav, type MobileNavLink } from "./MobileNav";
import { cn } from "@/lib/cn";

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/markets", label: "Markets" },
  { href: "/dashboard", label: "My swaps" },
];

interface Props {
  onConnectWallet: () => void;
}

/**
 * Editorial newspaper masthead used across every in-app page.
 * Date strip · wordmark + Polygon mark · primary nav · wallet pill.
 * Collapses to logo + hamburger below `lg` breakpoint.
 */
export function Masthead({ onConnectWallet }: Props) {
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const mobileLinks: MobileNavLink[] = NAV_LINKS.map((l) => ({
    ...l,
    active: isActive(l.href),
  }));

  return (
    <header className="border-b border-ink bg-paper">
      {/* Main bar */}
      <div className="page-container flex items-center justify-between gap-6 py-4 lg:py-5">
        <Wordmark
          logoSize={38}
          className="hover:no-underline"
          textClassName="tracking-tight text-ink lg:text-[26px]"
          aria-label="Polyswap home"
        />

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "text-sm transition-colors",
                isActive(l.href)
                  ? "text-ink underline decoration-accent decoration-2 underline-offset-[6px]"
                  : "text-ink-2 hover:text-ink"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <WalletButton onConnect={onConnectWallet} />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="-m-2 inline-flex size-11 items-center justify-center text-ink lg:hidden"
            aria-label="Open menu"
          >
            <Icon.menu size={20} aria-hidden />
          </button>
        </div>
      </div>

      <MobileNav
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        links={mobileLinks}
        footer={
          <p className="text-xs text-ink-3">Money stays in your wallet until the trigger fires.</p>
        }
      />
    </header>
  );
}
