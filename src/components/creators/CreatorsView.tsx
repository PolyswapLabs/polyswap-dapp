import Image from "next/image";
import { GithubIcon, Icon, LinkedinIcon, XIcon } from "@/components/icons";

interface Creator {
  name: string;
  role: string;
  bio?: string;
  github: { handle: string; url: string };
  twitter?: { handle: string; url: string };
  linkedin?: { handle: string; url: string };
}

const CREATORS: Creator[] = [
  {
    name: "Lucas Leclerc",
    role: "Co-founder & builder",
    github: { handle: "Intermarch3", url: "https://github.com/Intermarch3" },
    twitter: { handle: "@intermarch3", url: "https://x.com/intermarch3" },
    linkedin: { handle: "leclerclucas", url: "https://www.linkedin.com/in/leclerclucas" },
  },
  {
    name: "Baptiste Florentin",
    role: "Co-founder & builder",
    github: { handle: "Pybast", url: "https://github.com/Pybast" },
    twitter: { handle: "@Pybast", url: "https://x.com/Pybast" },
    linkedin: { handle: "pybast", url: "https://www.linkedin.com/in/pybast/" },
  },
];

export function CreatorsView() {
  return (
    <div className="space-y-12 py-10 lg:py-16">
      <header className="border-b border-ink pb-10">
        <h1 className="font-serif text-4xl leading-tight sm:text-5xl lg:text-[64px]">
          Two builders.
          <br />
          One conviction.
        </h1>
        <p className="mt-6 max-w-xl font-serif text-lg leading-snug text-ink-2 sm:text-xl">
          Polyswap started as a hackathon project at ETHGlobal Bangkok. We built every part
          end-to-end &mdash; contracts, listener, dapp, design.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2 lg:gap-8">
        {CREATORS.map((c) => (
          <CreatorCard key={c.github.handle} creator={c} />
        ))}
      </div>
    </div>
  );
}

function CreatorCard({ creator }: { creator: Creator }) {
  const avatar = `https://github.com/${creator.github.handle}.png?size=240`;
  return (
    <article className="flex flex-col border border-ink bg-paper">
      <div className="flex items-start gap-5 border-b border-rule-soft p-6 sm:p-8">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden border border-ink bg-paper-2 sm:h-24 sm:w-24">
          <Image
            src={avatar}
            alt={`${creator.name} avatar`}
            fill
            sizes="(min-width: 640px) 96px, 80px"
            className="object-cover"
            unoptimized
          />
        </div>
        <div className="min-w-0">
          <h2 className="font-serif text-2xl leading-tight sm:text-3xl">{creator.name}</h2>
          <p className="mt-1 text-sm text-ink-3">{creator.role}</p>
          {creator.bio && (
            <p className="mt-3 font-serif text-base leading-snug text-ink-2 sm:text-lg">
              {creator.bio}
            </p>
          )}
        </div>
      </div>

      <ul className="grid grid-cols-1 divide-y divide-rule-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SocialRow
          icon="github"
          label="GitHub"
          handle={creator.github.handle}
          url={creator.github.url}
        />
        {creator.twitter && (
          <SocialRow
            icon="twitter"
            label="X"
            handle={creator.twitter.handle}
            url={creator.twitter.url}
          />
        )}
        {creator.linkedin && (
          <SocialRow
            icon="linkedin"
            label="LinkedIn"
            handle={creator.linkedin.handle}
            url={creator.linkedin.url}
          />
        )}
      </ul>
    </article>
  );
}

const SOCIAL_ICON = {
  github: GithubIcon,
  twitter: XIcon,
  linkedin: LinkedinIcon,
} as const;

function SocialRow({
  icon,
  label,
  handle,
  url,
}: {
  icon: keyof typeof SOCIAL_ICON;
  label: string;
  handle: string;
  url: string;
}) {
  const SocialIcon = SOCIAL_ICON[icon];
  return (
    <li>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-paper-2"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <SocialIcon />
          <span className="sr-only">{label}:</span>
          <span className="num truncate text-xs text-ink-2">{handle}</span>
        </span>
        <Icon.arrowUpRight
          size={14}
          className="shrink-0 text-ink-3 transition-colors group-hover:text-ink"
          aria-hidden
        />
      </a>
    </li>
  );
}
