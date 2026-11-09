"use client";

import { useEffect, useMemo } from "react";
import type { CreateFormState } from "@/hooks/useCreateOrder";
import { useTokens } from "@/hooks/useTokens";
import type { TokenViewModel } from "@/types/design";

const DEFAULT_FROM_SYMBOLS = ["USDC", "USDC.e", "USDT", "DAI"] as const;
const DEFAULT_TO_SYMBOLS = ["WETH", "WBTC", "WPOL"] as const;

function findBySymbol(
  tokens: TokenViewModel[],
  preferred: ReadonlyArray<string>
): TokenViewModel | undefined {
  for (const symbol of preferred) {
    const match = tokens.find((t) => t.symbol === symbol);
    if (match) return match;
  }
  return undefined;
}

/** Loads the token list and pre-selects a sensible pair once it arrives. */
export function useDefaultTokens(
  state: Pick<CreateFormState, "fromToken" | "toToken">,
  set: <K extends "fromToken" | "toToken">(key: K, value: CreateFormState[K]) => void
) {
  const { data: fetchedTokens = [], isLoading } = useTokens();

  const tokens = useMemo<TokenViewModel[]>(() => {
    return fetchedTokens.map<TokenViewModel>((t) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address as `0x${string}`,
      decimals: t.decimals,
      logoURI: t.logoURI,
    }));
  }, [fetchedTokens]);

  useEffect(() => {
    if (tokens.length === 0) return;

    if (state.fromToken === null) {
      const pick = findBySymbol(tokens, DEFAULT_FROM_SYMBOLS) ?? tokens[0];
      if (pick) set("fromToken", pick);
    }
    if (state.toToken === null) {
      const pick =
        findBySymbol(tokens, DEFAULT_TO_SYMBOLS) ??
        tokens.find((t) => t.address !== state.fromToken?.address) ??
        tokens[0];
      if (pick) set("toToken", pick);
    }
  }, [tokens, state.fromToken, state.toToken, set]);

  return { tokens, isLoading };
}
