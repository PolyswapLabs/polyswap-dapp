import type { Metadata } from "next";

export const SITE_URL = "https://polyswap.lucasl.dev";

const SHARE_IMAGE = "/landing/thumbnail.png";

export function publicPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Polyswap",
      title,
      description,
      url: path,
      images: [
        {
          url: SHARE_IMAGE,
          width: 1730,
          height: 909,
          alt: "Polyswap illustration of an odds trigger connecting a wallet to a token swap",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE],
    },
  };
}

export const PRIVATE_PAGE_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: true,
};
