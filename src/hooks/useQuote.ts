"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  CowQuoteError,
  fetchCowQuote,
  type CowQuote,
  type CowQuoteParams,
} from "@/client/api/cowApi";

/** Quotes expire quickly. */
const QUOTE_STALE_MS = 30_000;

/** Fetches a CoW Protocol swap quote on the client. Idle while `params` is null. */
export function useQuote(params: CowQuoteParams | null) {
  return useQuery<CowQuote>({
    queryKey: [
      "cow-quote",
      params?.sellToken,
      params?.buyToken,
      params?.sellAmount,
      params?.userAddress,
    ],
    queryFn: params ? () => fetchCowQuote(params) : skipToken,
    staleTime: QUOTE_STALE_MS,
    retry: (failureCount, error) => {
      if (error instanceof CowQuoteError && error.errorType !== null) return false;
      return failureCount < 2;
    },
  });
}
