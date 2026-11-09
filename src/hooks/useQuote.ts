"use client";

import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";

// Network-specific CoW Protocol API base URLs.
const NETWORK_URLS: Readonly<Record<number, string>> = {
  1: "https://api.cow.fi/mainnet",
  100: "https://api.cow.fi/xdai",
  42161: "https://api.cow.fi/arbitrum",
  8453: "https://api.cow.fi/base",
  137: "https://api.cow.fi/polygon",
};

// WETH/wrapped-native addresses per network.
const WETH_ADDRESSES: Readonly<Record<number, string>> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  100: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  8453: "0x4200000000000000000000000000000000000006",
  137: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
};

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** 30-second stale time — quotes expire quickly. */
const STALE_MS = 30_000;

export class CowQuoteError extends Error {
  readonly errorType: string | null;
  readonly description: string | null;
  readonly status: number;
  constructor(
    message: string,
    errorType: string | null,
    description: string | null,
    status: number
  ) {
    super(message);
    this.name = "CowQuoteError";
    this.errorType = errorType;
    this.description = description;
    this.status = status;
  }
}

/**
 * Returns true only when `s` is a valid decimal integer string that parses to
 * a positive BigInt. Protects the `enabled` guard from throwing on inputs like
 * ".", "1e18", or "abc" — which BigInt() would turn into a SyntaxError.
 */
function isPositiveBigIntString(s: string): boolean {
  try {
    return BigInt(s) > 0n;
  } catch {
    return false;
  }
}

// Shape of the CoW quote API response body.
interface CowQuoteApiResponse {
  quote: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    buyAmount: string;
    feeAmount: string;
    validTo: number;
    kind: string;
    partiallyFillable: boolean;
    sellTokenBalance: string;
    buyTokenBalance: string;
    signingScheme: string;
    receiver: string;
    appData: string;
  };
  from: string;
  expiration: string;
  id: number;
  verified: boolean;
}

interface QuoteResult {
  buyAmount: string;
  sellAmount: string;
  feeAmount: string;
  validTo: number;
  /** Exchange rate: buyAmount / sellAmount (both in wei, high precision). */
  exchangeRate: string;
}

interface QuoteParams {
  sellToken: string;
  buyToken: string;
  /** Amount to sell in wei (as a decimal string). */
  sellAmount: string;
  userAddress: string;
  /** Chain ID — defaults to 137 (Polygon). */
  chainId?: number;
}

function getApiUrl(chainId: number): string {
  const url = NETWORK_URLS[chainId];
  if (!url) {
    throw new Error(
      `useQuote: unsupported chainId ${chainId}. Supported: ${Object.keys(NETWORK_URLS).join(", ")}`
    );
  }
  return url;
}

function resolveWeth(tokenAddress: string, chainId: number): string {
  if (tokenAddress.toLowerCase() !== ETH_ADDRESS.toLowerCase()) return tokenAddress;
  const weth = WETH_ADDRESSES[chainId];
  if (!weth) throw new Error(`useQuote: no WETH address for chainId ${chainId}`);
  return weth;
}

async function fetchCowQuote(params: Required<QuoteParams>): Promise<QuoteResult> {
  const { sellToken, buyToken, sellAmount, userAddress, chainId } = params;

  const baseUrl = getApiUrl(chainId);
  const resolvedSell = resolveWeth(sellToken, chainId);
  const resolvedBuy = resolveWeth(buyToken, chainId);

  if (!isAddress(resolvedSell)) throw new Error(`useQuote: invalid sell token address`);
  if (!isAddress(resolvedBuy)) throw new Error(`useQuote: invalid buy token address`);
  if (!isAddress(userAddress)) throw new Error(`useQuote: invalid user address`);
  if (BigInt(sellAmount) <= 0n) throw new Error(`useQuote: sell amount must be > 0`);

  const requestBody = {
    sellToken: resolvedSell,
    buyToken: resolvedBuy,
    from: userAddress,
    receiver: userAddress,
    kind: "sell",
    sellAmountBeforeFee: sellAmount,
  };

  const res = await fetch(`${baseUrl}/api/v1/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errorText = await res.text();
    let errorType: string | null = null;
    let description: string | null = null;
    try {
      const parsed: unknown = JSON.parse(errorText);
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.errorType === "string") errorType = obj.errorType;
        if (typeof obj.description === "string") description = obj.description;
      }
    } catch {
      // not JSON
    }
    throw new CowQuoteError(
      description ?? `CoW quote API error (${res.status})`,
      errorType,
      description,
      res.status
    );
  }

  const json: unknown = await res.json();

  // Runtime guard: ensure the expected nested structure is present.
  if (
    typeof json !== "object" ||
    json === null ||
    typeof (json as Record<string, unknown>).quote !== "object"
  ) {
    throw new Error(`useQuote: unexpected API response shape`);
  }

  const data = json as CowQuoteApiResponse;

  if (!data.quote.buyAmount || !data.quote.sellAmount) {
    throw new Error(`useQuote: missing buyAmount/sellAmount in CoW response`);
  }

  const buyAmountBigInt = BigInt(data.quote.buyAmount);
  const sellAmountBigInt = BigInt(data.quote.sellAmount);

  // BigInt arithmetic for the multiplication step keeps precision; final ratio
  // is computed in JS Number — adequate for typical token amounts but not exact
  // for extreme values (> ~2^53 after division).
  const PRECISION = 1_000_000_000_000n;
  const rate = (buyAmountBigInt * PRECISION) / sellAmountBigInt;
  const exchangeRate = (Number(rate) / Number(PRECISION)).toString();

  return {
    buyAmount: data.quote.buyAmount,
    sellAmount: data.quote.sellAmount,
    feeAmount: data.quote.feeAmount ?? "0",
    validTo: data.quote.validTo ?? 0,
    exchangeRate,
  };
}

/**
 * Fetches a CoW Protocol swap quote directly from the CoW API on the client.
 * Disabled automatically when any required param is missing or invalid.
 */
export function useQuote(params: QuoteParams | null) {
  const chainId = params?.chainId ?? 137;

  const enabled =
    params !== null &&
    isPositiveBigIntString(params.sellAmount) &&
    isAddress(params.userAddress) &&
    params.sellToken.length > 0 &&
    params.buyToken.length > 0 &&
    params.sellToken !== params.buyToken;

  return useQuery<QuoteResult>({
    queryKey: [
      "cow-quote",
      chainId,
      params?.sellToken,
      params?.buyToken,
      params?.sellAmount,
      params?.userAddress,
    ],
    queryFn: () => {
      // `enabled` guard ensures params is non-null here, but we cast
      // explicitly to satisfy TypeScript's control-flow analysis.
      const p = params as Required<QuoteParams>;
      return fetchCowQuote({ ...p, chainId });
    },
    enabled,
    staleTime: STALE_MS,
    retry: (failureCount, error) => {
      if (error instanceof CowQuoteError && error.errorType !== null) return false;
      return failureCount < 2;
    },
  });
}
