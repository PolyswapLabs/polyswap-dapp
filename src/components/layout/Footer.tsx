import Link from "next/link";
import { Icon } from "@/components/icons";
import { Logo } from "./Logo";

interface ExternalLink {
  href: string;
  label: string;
  caption?: string;
}

const GITHUB_LINKS: ExternalLink[] = [
  {
    href: "https://github.com/PolyswapLabs/polyswap-dapp",
    label: "polyswap-dapp",
    caption: "Frontend + listener",
  },
  {
    href: "https://github.com/PolyswapLabs/polyswap-contracts",
    label: "polyswap-contracts",
    caption: "Solidity",
  },
];

const BUILT_WITH: ExternalLink[] = [
  { href: "https://polymarket.com", label: "Polymarket" },
  { href: "https://cow.fi", label: "CoW Protocol" },
  { href: "https://polygon.technology", label: "Polygon" },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-ink bg-paper">
      <div className="mx-auto max-w-[1280px] px-6 py-12 sm:px-8 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-3">
              <Logo size={38} />
              <span className="font-serif text-2xl">Polyswap</span>
            </div>
            <p className="mt-4 max-w-md font-serif text-lg leading-snug text-ink-2">
              Pin a token swap to a real-world question. We watch the odds. When they cross your
              line — and only then — the swap fires.
            </p>
          </div>

          <div className="lg:col-span-3">
            <p className="eyebrow mb-4">GitHub</p>
            <ul className="space-y-3 text-sm">
              {GITHUB_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-start gap-1.5"
                  >
                    <span className="flex flex-col">
                      <span className="num group-hover:underline">{l.label}</span>
                      {l.caption && <span className="text-xs text-ink-3">{l.caption}</span>}
                    </span>
                    <Icon.arrowUpRight
                      size={11}
                      className="mt-1 text-ink-3 transition-colors group-hover:text-ink"
                      aria-hidden
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <p className="eyebrow mb-4">Built with</p>
            <ul className="space-y-2 text-sm">
              {BUILT_WITH.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-1.5 hover:underline"
                  >
                    {l.label}
                    <Icon.arrowUpRight
                      size={11}
                      className="text-ink-3 transition-colors group-hover:text-ink"
                      aria-hidden
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <p className="eyebrow mb-4">Read on</p>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/markets" className="hover:underline">
                  Browse markets
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:underline">
                  My swaps
                </Link>
              </li>
              <li>
                <Link href="/#how-it-works" className="hover:underline">
                  How it works
                </Link>
              </li>
              <li>
                <Link href="/#faq" className="hover:underline">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/creators" className="hover:underline">
                  Creators
                </Link>
              </li>
              <li>
                <Link href="/api-docs" className="hover:underline">
                  API docs
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-rule-soft pt-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Polyswap</p>
          <p className="num">v1.0</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
