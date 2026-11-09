"use client";

import { useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/layout/Logo";
import { buttonVariants } from "@/components/primitives";
import { Icon } from "@/components/icons";
import { MobileNav, type MobileNavLink } from "@/components/layout/MobileNav";

// Root-relative anchors: this header is also used on /creators.
const ANCHOR_LINKS: { href: string; label: string }[] = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/markets", label: "Markets" },
  { href: "/#faq", label: "FAQ" },
];

const MOBILE_LINKS: MobileNavLink[] = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/markets", label: "Browse markets" },
  { href: "/dashboard", label: "My swaps" },
  { href: "/#faq", label: "FAQ" },
];

export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-b border-ink bg-paper">
      <div className="page-container flex h-16 items-center justify-between">
        <Wordmark />

        <nav className="hidden items-center gap-7 text-sm lg:flex" aria-label="Primary">
          {ANCHOR_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:underline">
              {l.label}
            </a>
          ))}
          <Link href="/markets" className={buttonVariants({ variant: "ink", size: "sm" })}>
            Open app
            <Icon.arrowRight size={14} aria-hidden />
          </Link>
        </nav>

        <div className="flex items-center gap-2 lg:hidden">
          <Link href="/markets" className={buttonVariants({ variant: "ink", size: "sm" })}>
            Open app
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="-m-2 inline-flex size-11 items-center justify-center"
            aria-label="Open menu"
          >
            <Icon.menu size={20} aria-hidden />
          </button>
        </div>
      </div>

      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} links={MOBILE_LINKS} />
    </header>
  );
}
