import { cn } from "@/lib/cn";

const TOKEN_COLORS: Record<string, string> = {
  USDC: "#2775ca",
  USDT: "#26a17b",
  DAI: "#f5ac37",
  WETH: "#5e6b8c",
  ETH: "#5e6b8c",
  WBTC: "#f7931a",
  BTC: "#f7931a",
  WPOL: "#7b3ff2",
  POL: "#7b3ff2",
  MATIC: "#7b3ff2",
  LINK: "#2a5ada",
  AAVE: "#b6509e",
};

const TOKEN_GLYPH: Record<string, string> = {
  WETH: "Ξ",
  ETH: "Ξ",
  WBTC: "₿",
  BTC: "₿",
};

interface Props {
  symbol: string;
  size?: number;
  className?: string;
}

export function TokenGlyph({ symbol, size = 22, className }: Props) {
  const bg = TOKEN_COLORS[symbol] ?? "#444";
  const glyph = TOKEN_GLYPH[symbol] ?? symbol[0] ?? "?";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center border-[1.5px] border-ink font-mono font-semibold text-paper",
        className
      )}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.5 }}
      aria-hidden
    >
      {glyph}
    </span>
  );
}
