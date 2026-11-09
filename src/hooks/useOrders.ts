"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getOrdersByOwner } from "@/client/api/polyswapApi";
import { getErrorMessage } from "@/utils/errors";
import { useTokens } from "@/hooks/useTokens";
import { buildTokenMap, toOrderView, type OrderViewModel } from "@/hooks/orders/orderMapper";

const ORDERS_STALE_MS = 30_000;

export const ordersQueryKey = (owner: string | undefined) => ["orders", owner] as const;

interface UseOrdersResult {
  orders: OrderViewModel[];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  walletConnected: boolean;
}

export function useOrders(): UseOrdersResult {
  const { address, isConnected } = useAccount();
  const tokensQ = useTokens();

  const query = useQuery({
    queryKey: ordersQueryKey(address),
    queryFn: async () => {
      if (!address) return [];
      const res = await getOrdersByOwner(address);
      if (!res.success || !res.data) return [];
      return res.data;
    },
    enabled: Boolean(address),
    staleTime: ORDERS_STALE_MS,
  });

  const tokenMap = buildTokenMap(tokensQ.data);

  // We don't fetch market titles inline — they're optional and the row still
  // renders without them. A follow-up could batch market lookups by id.
  const orders = (query.data ?? []).map((o) => toOrderView(o, tokenMap));

  const failure = query.error ?? tokensQ.error;

  return {
    orders,
    isLoading: query.isLoading || tokensQ.isLoading,
    isError: query.isError || tokensQ.isError,
    errorMessage: failure ? getErrorMessage(failure, "Failed to load orders") : null,
    walletConnected: isConnected,
  };
}

export function useOrder(orderId: string): {
  order: OrderViewModel | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  walletConnected: boolean;
} {
  const { orders, isLoading, isError, errorMessage, walletConnected } = useOrders();
  const order = orders.find((o) => o.id === orderId) ?? null;
  return { order, isLoading, isError, errorMessage, walletConnected };
}
