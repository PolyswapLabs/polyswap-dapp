import Image from "next/image";
import type { MarketCategory } from "@/shared/markets/categories";

interface Props {
  category: MarketCategory;
  size?: number;
  className?: string;
}

const CHART = { src: "/landing/glyph/glyph_1.png", alt: "Trendline chart" };
const FLAG = { src: "/landing/glyph/glyph_2.png", alt: "Capitol with flag" };
const COIN = { src: "/landing/glyph/glyph_3.png", alt: "Coin with up arrow" };
const GLOBE = { src: "/landing/glyph/glyph_4.png", alt: "Globe with a pin" };

const GLYPHS: Record<MarketCategory, { src: string; alt: string }> = {
  Politics: FLAG,
  Elections: FLAG,
  Geopolitics: GLOBE,
  Crypto: COIN,
  Sports: GLOBE,
  Soccer: GLOBE,
  Esports: COIN,
  Tech: COIN,
  AI: COIN,
  Culture: GLOBE,
  Finance: CHART,
  Economy: CHART,
  Weather: CHART,
};

export function CategoryIllustration({ category, size = 64, className }: Props) {
  const { src, alt } = GLYPHS[category];
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: "auto" }}
    />
  );
}
