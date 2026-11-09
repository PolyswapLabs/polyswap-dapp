"use client";

import { useQuery } from "@tanstack/react-query";
import { polygon } from "wagmi/chains";
import { isRecord } from "@/services/api";

export interface Token {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

// Shape expected from each CoW token-list JSON file.
interface TokenListResponse {
  tokens: Token[];
}

const TOKEN_LIST_URLS = [
  "https://files.cow.fi/tokens/CowSwap.json",
  "https://raw.githubusercontent.com/cowprotocol/token-lists/main/src/public/CoinGecko.137.json",
  "https://raw.githubusercontent.com/cowprotocol/token-lists/main/src/public/Uniswap.137.json",
] as const;

/** Token lists change rarely. */
const TOKEN_LIST_STALE_MS = 30 * 60_000;
/** Must exceed TOKEN_LIST_STALE_MS so cached data survives the stale window. */
const TOKEN_LIST_GC_MS = 60 * 60_000;

/** One unavailable list must not hide the tokens of the others. */
async function fetchTokenList(url: string): Promise<TokenListResponse | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (!isRecord(json) || !Array.isArray(json.tokens)) throw new Error("unexpected shape");
    return { tokens: json.tokens };
  } catch (err) {
    console.warn(`useTokens: could not load ${url}:`, err);
    return null;
  }
}

async function fetchPolygonTokens(): Promise<Token[]> {
  const results = await Promise.all(TOKEN_LIST_URLS.map(fetchTokenList));

  // Deduplicate by address (lower-cased). Prefer the entry that already has a
  // logoURI when two lists contain the same token address.
  const tokenMap = new Map<string, Token>();

  for (const list of results) {
    if (!list) continue;
    for (const token of list.tokens) {
      if (token.chainId !== polygon.id) continue;
      const key = token.address.toLowerCase();
      const existing = tokenMap.get(key);
      if (!existing || (!existing.logoURI && token.logoURI)) {
        tokenMap.set(key, {
          chainId: token.chainId,
          address: token.address,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          logoURI: token.logoURI,
        });
      }
    }
  }

  const tokens = Array.from(tokenMap.values());
  tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return tokens;
}

/**
 * Fetches the CoW Protocol token lists directly from the client and returns
 * all tokens available on Polygon, deduplicated and sorted by
 * symbol.
 */
export function useTokens() {
  return useQuery<Token[]>({
    queryKey: ["cow-tokens"],
    queryFn: fetchPolygonTokens,
    staleTime: TOKEN_LIST_STALE_MS,
    gcTime: TOKEN_LIST_GC_MS,
  });
}
