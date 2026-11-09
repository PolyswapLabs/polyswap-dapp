import { Icon } from "@/components/icons";

interface Guarantee {
  Ico: typeof Icon.lock;
  title: string;
  body: string;
}

const ITEMS: Guarantee[] = [
  {
    Ico: Icon.lock,
    title: "Non-custodial and Permissionless",
    body: "Your tokens never leave your wallet until your trigger fires. Polyswap can't withdraw, swap, or move funds on its own. Ever.",
  },
  {
    Ico: Icon.shield,
    title: "Cancel anytime",
    body: "Change your mind? Pull the swap with one click. No fee, no penalty, no questions.",
  },
];

export function Guarantees() {
  return (
    <section className="border-b border-ink">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-6 py-12 sm:px-8 lg:grid-cols-12 lg:px-12 lg:py-20">
        <div className="lg:col-span-5">
          <p className="eyebrow mb-3">Two guarantees</p>
          <h2 className="display text-4xl leading-[1.0] sm:text-5xl lg:text-[60px]">
            We never <span className="display-italic">touch </span> your money.
          </h2>
        </div>
        <div className="grid border border-ink sm:grid-cols-2 lg:col-span-7">
          {ITEMS.map((it, i) => (
            <div
              key={it.title}
              className={`p-6 sm:p-8 ${i === 0 ? "border-b border-ink sm:border-r sm:border-b-0" : ""}`}
            >
              <it.Ico size={28} aria-hidden />
              <h3 className="mt-4 font-serif text-xl lg:text-2xl">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
