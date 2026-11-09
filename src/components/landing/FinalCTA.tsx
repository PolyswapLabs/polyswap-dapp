import Link from "next/link";

export function FinalCTA() {
  return (
    <section className="border-b border-ink bg-accent text-paper">
      <div className="page-container grid items-center gap-8 py-16 lg:grid-cols-12 lg:gap-10 lg:py-24">
        <h2 className="display text-5xl leading-[0.96] sm:text-6xl lg:col-span-8 lg:text-[80px]">
          Set up your
          <br />
          <span className="display-italic">first swap</span> →
        </h2>
        <div className="lg:col-span-4 lg:justify-self-end">
          <Link
            href="/markets"
            className="inline-flex items-center gap-3 border border-ink bg-paper px-6 py-4 text-base font-medium text-ink shadow-stamp-lg transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_var(--color-ink)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none lg:px-12 lg:py-5 lg:text-lg"
          >
            Open the app →
          </Link>
        </div>
      </div>
    </section>
  );
}
