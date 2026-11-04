import {
  createPublicClient,
  createWalletClient,
  webSocket,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { resilientHttp } from "@/lib/rpc/resilientHttp";
import { createLogger } from "@/backend/logger";

const log = createLogger("rpc");

let cachedPublicClient: PublicClient | null = null;
let cachedWebSocketClient: PublicClient | null = null;
let webSocketGeneration = 0;
let cachedWalletClient: WalletClient | null = null;

export function getPublicClient(): PublicClient {
  if (cachedPublicClient) return cachedPublicClient;
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is not set");
  cachedPublicClient = createPublicClient({
    chain: polygon,
    transport: resilientHttp(rpcUrl, { onRetry: logRetry }),
  });
  return cachedPublicClient;
}

export function getWebSocketClient(): PublicClient {
  if (cachedWebSocketClient) return cachedWebSocketClient;
  const wssUrl = process.env.WSS_RPC_URL;
  if (!wssUrl) throw new Error("WSS_RPC_URL is not set");
  cachedWebSocketClient = createPublicClient({
    chain: polygon,
    transport: webSocket(wssUrl, {
      // webSocketSupervisor.ts owns reconnecting.
      reconnect: false,
      // viem shares sockets by these options. A distinct value keeps a replacement
      // from joining the old socket while that one is still connecting or closing.
      keepAlive: { interval: 30_000 + webSocketGeneration++ },
    }),
  });
  return cachedWebSocketClient;
}

/** Forgets the socket. Never waits: closing one that is still connecting can take minutes. */
export function closeWebSocketClient(): void {
  const client = cachedWebSocketClient;
  cachedWebSocketClient = null;
  if (!client) return;
  const { getRpcClient } = client.transport as unknown as {
    getRpcClient: () => Promise<{ close: () => void }>;
  };
  void getRpcClient()
    .then((rpcClient) => rpcClient.close())
    .catch(() => log.debug("old socket was already gone"));
}

export function getWalletClient(): WalletClient {
  if (cachedWalletClient) return cachedWalletClient;
  const pk = process.env.PK;
  if (!pk) throw new Error("PK is not set");
  const privateKey: Hex = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  const account = privateKeyToAccount(privateKey);
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is not set");
  cachedWalletClient = createWalletClient({
    account,
    chain: polygon,
    transport: resilientHttp(rpcUrl, { onRetry: logRetry }),
  });
  return cachedWalletClient;
}

function logRetry({
  attempt,
  delayMs,
  error,
}: {
  attempt: number;
  delayMs: number;
  error: unknown;
}): void {
  const reason = error instanceof Error ? error.message : String(error);
  log.warn(`attempt ${attempt} failed, retrying in ${delayMs}ms: ${reason}`);
}
