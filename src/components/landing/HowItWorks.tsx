import Image from "next/image";

interface Step {
  n: string;
  title: string;
  body: string;
  src: string;
  alt: string;
}

const STEPS: Step[] = [
  {
    n: "01",
    title: "Pick a question.",
    body: "Browse Polymarket questions about elections, rate cuts, ceasefires, token launches — anything that can move crypto.",
    src: "/landing/poll.png",
    alt: "A row of figures voting under a banner asking 'Will it happen?'",
  },
  {
    n: "02",
    title: "Set your trigger.",
    body: "Pick the swap (in & out, amount). Then say when it should fire — for example, when YES odds reach 70%.",
    src: "/landing/swap.png",
    alt: "A chart climbing past a 70% threshold with a SWAP stamp",
  },
  {
    n: "03",
    title: "Sign once. Walk away.",
    body: "Your tokens stay in your wallet. We watch the odds, and when they cross your line, the swap fires automatically.",
    src: "/landing/locked.png",
    alt: "A wallet padlocked with sleep marks and a clock",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-ink" style={{ scrollMarginTop: "5rem" }}>
      <div className="page-container py-12 lg:py-20">
        <h2 className="display mb-8 text-4xl sm:text-5xl lg:mb-10 lg:text-[56px]">
          How it <span className="display-italic">works.</span>
        </h2>
        <div className="grid border border-ink lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={`p-6 sm:p-8 ${
                i < STEPS.length - 1
                  ? "border-b border-ink lg:border-b-0 lg:[&:not(:last-child)]:border-r"
                  : ""
              }`}
            >
              <div className="mb-4 flex items-baseline gap-4">
                <span className="num text-sm text-ink-3">{s.n}</span>
                <h3 className="display text-2xl sm:text-3xl lg:text-[32px]">{s.title}</h3>
              </div>
              <div className="-mx-2 my-5 flex justify-center">
                <Image
                  src={s.src}
                  alt={s.alt}
                  width={280}
                  height={220}
                  className="h-auto w-[280px]"
                />
              </div>
              <p className="font-serif text-base leading-snug text-ink-2 sm:text-lg">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
