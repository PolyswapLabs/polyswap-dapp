export function Premise() {
  return (
    <section className="border-b border-ink bg-paper-2">
      <div className="page-container grid gap-6 py-12 lg:grid-cols-12 lg:gap-10 lg:py-14">
        <p className="eyebrow lg:col-span-3">The premise</p>
        <p className="display text-3xl leading-[1.1] sm:text-4xl lg:col-span-9 lg:text-[44px]">
          Crypto prices move when the <span className="display-italic">news </span>
          moves. Rate cuts, elections, geopolitics, token launches — all of it bleeds into the
          chart. Polyswap lets you act on that link <span className="display-italic">
            before
          </span>{" "}
          the chart catches up.
        </p>
      </div>
    </section>
  );
}
