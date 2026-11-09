"use client";

import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";
import { polygon } from "wagmi/chains";
import { isRecord } from "@/services/api";

/** CoW Protocol BFF API base URL. */
const BFF_BASE_URL = "https://bff.cow.fi";

/** Prices move frequently. */
const TOKEN_PRICE_STALE_MS = 60_000;

async function fetchTokenUsdPrice(tokenAddress: string, chainId: number): Promise<number | null> {
  const url = `${BFF_BASE_URL}/${chainId}/tokens/${tokenAddress}/usdPrice`;
  const res = await fetch(url);

  if (!res.ok) {
    // 404 just means the token isn't priced — not a hard error.
    if (res.status === 404) return null;
    throw new Error(
      `CoW BFF price fetch failed for ${tokenAddress} on chain ${chainId}: ${res.status}`
    );
  }

  const json: unknown = await res.json();

  if (!isRecord(json) || typeof json.price !== "number") {
    throw new Error(
      `Unexpected BFF price response shape for ${tokenAddress}: ${JSON.stringify(json)}`
    );
  }

  return json.price;
}

interface UseTokenPriceOptions {
  /** Token contract address (checksummed or lowercase). */
  tokenAddress: string;
  /** Chain ID — defaults to Polygon. */
  chainId?: number;
}

/**
 * Fetches the USD price for a single token directly from the CoW Protocol BFF
 * API. Returns `null` when the price is unavailable (e.g. illiquid token).
 */
export function useTokenPrice({ tokenAddress, chainId = polygon.id }: UseTokenPriceOptions) {
  const enabled = isAddress(tokenAddress);

  return useQuery<number | null>({
    queryKey: ["cow-token-price", chainId, tokenAddress.toLowerCase()],
    queryFn: () => fetchTokenUsdPrice(tokenAddress, chainId),
    enabled,
    staleTime: TOKEN_PRICE_STALE_MS,
  });
}
