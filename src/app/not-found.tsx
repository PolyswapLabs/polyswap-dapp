import Link from "next/link";
import { Button, Stamp } from "@/components/primitives";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/layout/Logo";

export const metadata = {
  title: "Filed under: missing · Polyswap",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-ink">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6 sm:px-8 lg:px-12">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={36} />
            <span className="font-serif text-2xl">Polyswap</span>
          </Link>
          <Link href="/markets" className="text-sm underline underline-offset-4">
            Open the app →
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-10 px-6 py-16 sm:px-8 lg:grid-cols-12 lg:gap-12 lg:px-12 lg:py-24">
          <div className="lg:col-span-7">
            <p className="eyebrow mb-4">Issue · 404 · April edition</p>
            <h1 className="display text-5xl leading-[0.95] sm:text-6xl lg:text-[88px]">
              Filed under
              <br />
              <span className="display-italic">missing.</span>
            </h1>
            <p className="mt-6 max-w-[520px] font-serif text-lg leading-snug text-ink-2 sm:text-xl">
              We checked the archive twice. This URL never went to print, or the issue ran out
              before you got there.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/">
                <Button variant="ink" size="lg">
                  <Icon.arrowLeft size={14} aria-hidden />
                  Back to the front page
                </Button>
              </Link>
              <Link href="/markets">
                <Button variant="paper" size="lg">
                  Browse markets
                  <Icon.arrowRight size={14} aria-hidden />
                </Button>
              </Link>
            </div>
          </div>

          <div className="hidden lg:col-span-5 lg:flex lg:justify-end">
            <div className="relative">
              <div className="border border-ink bg-paper-2 p-10">
                <p className="num text-[120px] leading-none font-semibold tracking-tighter text-ink">
                  404
                </p>
                <p className="eyebrow mt-4">Page not found</p>
                <p className="mt-1 text-xs text-ink-3">no such issue in our records</p>
              </div>
              <div className="absolute -top-4 -right-4">
                <Stamp>Returned to sender</Stamp>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-ink">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-6 text-xs text-ink-3 sm:px-8 lg:px-12">
          <p>© {new Date().getFullYear()} Polyswap. Runs on Polygon.</p>
          <p className="num">404 · static</p>
        </div>
      </footer>
    </div>
  );
}
