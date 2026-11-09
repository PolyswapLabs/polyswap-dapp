"use client";

import { useState } from "react";
import { cn } from "@/utils/cn";

interface Props {
  symbol: string;
  logoURI?: string;
  size?: number;
  className?: string;
}

export function TokenLogo({ symbol, logoURI, size = 24, className }: Props) {
  const [errored, setErrored] = useState(false);
  const showImage = Boolean(logoURI) && !errored;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-paper-2 font-mono font-semibold text-ink",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoURI}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setErrored(true)}
          style={{ width: size, height: size, display: "block", objectFit: "cover" }}
        />
      ) : (
        (symbol[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}
