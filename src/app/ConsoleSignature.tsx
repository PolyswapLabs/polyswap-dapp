"use client";

import { useEffect } from "react";

/**
 * Logs a small editorial greeting once per page load. Only visible to people
 * who open DevTools — a wink to the developers and curious users who go
 * looking. Costs nothing at runtime, gets stripped if the bundle ever needs it.
 */
export function ConsoleSignature() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.__POLYSWAP_SIG__) return;
    window.__POLYSWAP_SIG__ = true;

    const head =
      "color:#16140f;background:#ece6da;font:600 14px/1.4 'Fraunces',serif;padding:6px 10px;border:1px solid #16140f;";
    const accent =
      "color:#d94a1f;background:#ece6da;font:500 11px/1 'JetBrains Mono',monospace;padding:6px 10px;border:1px solid #16140f;border-left:0;";
    const body = "color:#3a3528;font:13px/1.5 'Inter Tight',sans-serif;padding:8px 0 0;";

    console.log(
      "%cPolyswap%cVol. I · No. 1%c\nNon-custodial swaps, settled by Polymarket odds.\nSomething catch your eye? Read the contracts, open a PR, or just say hi.",
      head,
      accent,
      body
    );
  }, []);

  return null;
}

declare global {
  interface Window {
    __POLYSWAP_SIG__?: boolean;
  }
}
