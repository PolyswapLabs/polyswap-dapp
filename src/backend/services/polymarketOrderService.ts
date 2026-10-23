import { updateBalanceAllowance } from "@polymarket/client/actions";
import {
  AssetType,
  createSecureClient,
  forkEnvironmentConfig,
  OrderSide,
  type ApiKeyCreds,
  type EvmAddress,
  type OpenOrder,
  type SecureClient,
  type SignedOrder,
} from "@polymarket/client";
import { signerFrom } from "@polymarket/client/viem";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  erc1155Abi,
  maxUint256,
  recoverAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { resilientHttp } from "../../lib/rpc/resilientHttp";
import { assertAssetId } from "../../lib/polymarket/protocol";
import {
  getPolymarketContracts,
  getTradingConfig,
  type TradingContext,
} from "../polymarket/config";
import {
  computePolymarketOrderHash,
  ORDER_STATUS_ABI,
  parseStoredSignedOrder,
  type SignedOrderFormat,
} from "../polymarket/orders";

export interface PolymarketOrderConfig extends TradingContext {
  tokenID: string;
  price: number;
  side: "BUY" | "SELL";
  size: number | string;
  expiration?: number;
  postOnly?: boolean;
}

export interface PreparedGTDOrder {
  signedOrder: SignedOrder;
  signedOrderFormat: SignedOrderFormat;
  exchangeAddress: Address;
  makerAmount: string;
  polymarketOrderHash: Hex;
  expiration: number;
}

export interface ReadyClients {
  clobClient: SecureClient;
  publicClient: PublicClient;
  walletClient: WalletClient;
  ownerAddress: Address;
}

const MAX_FEE_ABI = [
  {
    type: "function",
    name: "MAX_FEE_RATE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** One boundary for SDK types, exchange selection, approvals and signed order IO. */
export class PolymarketOrderService {
  private static instance: PolymarketOrderService | null = null;
  private initialization: Promise<void> | null = null;

  constructor(private ready: ReadyClients | null = null) {}

  static getInstance(): PolymarketOrderService {
    return (this.instance ??= new PolymarketOrderService());
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    this.initialization ??= this.performInitialization().catch((error) => {
      this.initialization = null;
      throw error;
    });
    await this.initialization;
  }

  private async performInitialization(): Promise<void> {
    if (Number(process.env.CHAIN_ID ?? 137) !== 137) {
      throw new Error("Polymarket trading requires Polygon chain 137");
    }
    const pk = process.env.PK;
    if (!pk) throw new Error("Private key (PK) is not configured");
    const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
    const transport = resilientHttp(process.env.RPC_URL ?? "https://polygon.drpc.org");
    const publicClient = createPublicClient({ chain: polygon, transport });
    const walletClient = createWalletClient({ account, chain: polygon, transport });
    const credentials = {
      key: process.env.CLOB_API_KEY,
      secret: process.env.CLOB_SECRET,
      passphrase: process.env.CLOB_PASS_PHRASE,
    };
    if (!credentials.key || !credentials.secret || !credentials.passphrase) {
      throw new Error("CLOB credentials are not configured");
    }
    const contracts = getPolymarketContracts();
    const clobClient = await createSecureClient({
      wallet: account.address,
      signer: signerFrom(walletClient),
      credentials: credentials as ApiKeyCreds,
      environment: forkEnvironmentConfig({
        name: "polyswap-polygon",
        rpc: process.env.RPC_URL ?? "https://polygon.drpc.org",
        clob: { rest: process.env.CLOB_API_URL ?? "https://clob.polymarket.com" },
        contracts: {
          collateralToken: contracts.collateral as EvmAddress,
          conditionalTokens: contracts.ctf as EvmAddress,
          standardExchange: contracts.ctfExchange as EvmAddress,
          negRiskExchange: contracts.negRiskExchange as EvmAddress,
          exchangeV3: contracts.exchangeV3 as EvmAddress,
          positionManager: contracts.positionManager as EvmAddress,
        },
      }),
    });
    this.ready = { clobClient, publicClient, walletClient, ownerAddress: account.address };
  }

  private getReady(): ReadyClients {
    if (!this.ready) throw new Error("PolymarketOrderService is not initialized");
    return this.ready;
  }

  getClient(): SecureClient | null {
    return this.ready?.clobClient ?? null;
  }
  isReady(): boolean {
    return this.ready !== null;
  }

  async cancelAllOrders() {
    return this.getReady().clobClient.cancelAll();
  }
  async cancelOrder(orderId: string) {
    return this.getReady().clobClient.cancelOrder({ orderId });
  }
  async getOrder(orderId: string) {
    return this.getReady().clobClient.fetchOrder({ orderId });
  }

  async getOpenOrders(params: { market?: string; assetId?: string } = {}): Promise<OpenOrder[]> {
    const orders: OpenOrder[] = [];
    for await (const page of this.getReady().clobClient.listOpenOrders({
      market: params.market,
      assetId: params.assetId,
    })) {
      orders.push(...page.items);
    }
    return orders;
  }

  async getOnChainOrderStatus(orderHash: Hex, context: TradingContext) {
    return this.getReady().publicClient.readContract({
      address: getTradingConfig(context).exchange,
      abi: ORDER_STATUS_ABI,
      functionName: "getOrderStatus",
      args: [orderHash],
    });
  }

  /** Called by the seller/explicit setup, never by read-only diagnostics. */
  async ensureTradingApprovals(context: TradingContext): Promise<void> {
    const { walletClient, publicClient, ownerAddress, clobClient } = this.getReady();
    const { exchange, ledger } = getTradingConfig(context);
    const account = walletClient.account;
    if (!account) throw new Error("Approval wallet has no account");
    const collateral = getPolymarketContracts().collateral;
    const approved = await publicClient.readContract({
      address: ledger,
      abi: erc1155Abi,
      functionName: "isApprovedForAll",
      args: [ownerAddress, exchange],
    });
    if (!approved) {
      const hash = await walletClient.writeContract({
        account,
        chain: polygon,
        address: ledger,
        abi: erc1155Abi,
        functionName: "setApprovalForAll",
        args: [exchange, true],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Position approval reverted");
    }
    const allowance = await publicClient.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ownerAddress, exchange],
    });
    if (allowance !== maxUint256) {
      const hash = await walletClient.writeContract({
        account,
        chain: polygon,
        address: collateral,
        abi: erc20Abi,
        functionName: "approve",
        args: [exchange, maxUint256],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Collateral approval reverted");
    }
    await updateBalanceAllowance(clobClient, { assetType: AssetType.COLLATERAL });
  }

  private async checkBuyAllowance(order: SignedOrder, context: TradingContext): Promise<void> {
    const { publicClient, clobClient, ownerAddress } = this.getReady();
    const exchange = getTradingConfig(context).exchange;
    const amount = BigInt(order.makerAmount);
    // V2 fees are extra collateral; use the exchange's enforceable fee ceiling.
    const feeRate =
      context.protocolVersion === "v2"
        ? await publicClient.readContract({
            address: exchange,
            abi: MAX_FEE_ABI,
            functionName: "MAX_FEE_RATE",
          })
        : 0n;
    const required = amount + (amount * feeRate + 9_999n) / 10_000n;
    const allowance = await publicClient.readContract({
      address: getPolymarketContracts().collateral,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ownerAddress, exchange],
    });
    if (allowance < required) {
      throw new Error(`Insufficient pUSD allowance for ${exchange}, including the fee ceiling`);
    }
    await updateBalanceAllowance(clobClient, { assetType: AssetType.COLLATERAL });
  }

  private async validateSigner(order: SignedOrder, context: TradingContext): Promise<Hex> {
    const { ownerAddress } = this.getReady();
    const hash = computePolymarketOrderHash(order, context);
    const signer = await recoverAddress({ hash, signature: order.signature as Hex });
    if (
      signer.toLowerCase() !== ownerAddress.toLowerCase() ||
      order.maker.toLowerCase() !== ownerAddress.toLowerCase() ||
      order.signer.toLowerCase() !== ownerAddress.toLowerCase()
    ) {
      throw new Error(
        "Signed Polymarket order does not match the configured account, protocol and exchange"
      );
    }
    return hash;
  }

  private async createOrder(config: PolymarketOrderConfig): Promise<SignedOrder> {
    assertAssetId(config.tokenID);
    getTradingConfig(config);
    const requestedSize = Number(config.size);
    if (
      !Number.isFinite(config.price) ||
      config.price <= 0 ||
      config.price >= 1 ||
      !Number.isFinite(requestedSize) ||
      requestedSize <= 0
    ) {
      throw new Error("Invalid Polymarket price or size");
    }
    const { clobClient } = this.getReady();
    const size =
      config.side === "BUY"
        ? Math.max(requestedSize, Math.ceil((1.01 / config.price) * 100) / 100)
        : config.size;
    return clobClient.createLimitOrder({
      assetId: config.tokenID,
      price: config.price,
      size,
      side: config.side === "BUY" ? OrderSide.BUY : OrderSide.SELL,
      expiration: config.expiration,
      postOnly: config.postOnly ?? false,
    });
  }

  async postGTCOrder(config: PolymarketOrderConfig) {
    const order = await this.createOrder(config);
    await this.validateSigner(order, config);
    if (config.side === "BUY") await this.checkBuyAllowance(order, config);
    return { response: this.assertAccepted(await this.getReady().clobClient.postOrder(order)) };
  }

  async prepareGTDOrder(
    config: PolymarketOrderConfig & { expiration: number }
  ): Promise<PreparedGTDOrder> {
    if (config.side !== "BUY") throw new Error("Sentinels must be BUY orders");
    if (
      !Number.isSafeInteger(config.expiration) ||
      config.expiration < Math.floor(Date.now() / 1000) + 180
    ) {
      throw new Error("Polymarket deadline must be at least three minutes in the future");
    }
    // Expiry is never extended beyond the Safe's authorized deadline.
    for (let attempt = 0; attempt < 3; attempt++) {
      const signedOrder = await this.createOrder(config);
      const hash = await this.validateSigner(signedOrder, config);
      const status = await this.getOnChainOrderStatus(hash, config);
      if (!status.filled && status.remaining === 0n) {
        return {
          signedOrder,
          signedOrderFormat: "unified-v1",
          exchangeAddress: getTradingConfig(config).exchange,
          makerAmount: signedOrder.makerAmount,
          polymarketOrderHash: hash,
          expiration: signedOrder.expiration,
        };
      }
    }
    throw new Error("Could not obtain an unused Polymarket order hash");
  }

  async postPreparedGTDOrder(
    input: TradingContext & {
      signedOrder: unknown;
      signedOrderFormat: string;
      expectedHash: string;
      expectedMakerAmount: string;
      expectedTokenId: string;
      expectedExpiration: number;
      postOnly: boolean;
    }
  ) {
    const order = parseStoredSignedOrder(
      input.signedOrder,
      input.signedOrderFormat,
      input.postOnly
    );
    if (
      order.side !== OrderSide.BUY ||
      order.tokenId !== input.expectedTokenId ||
      order.makerAmount !== input.expectedMakerAmount ||
      order.expiration !== input.expectedExpiration
    ) {
      throw new Error("Stored sentinel commitments do not match the signed order");
    }
    if (order.expiration <= Math.floor(Date.now() / 1000)) {
      throw new Error("Sentinel expired before submission");
    }
    const hash = await this.validateSigner(order, input);
    if (hash.toLowerCase() !== input.expectedHash.toLowerCase()) {
      throw new Error("Stored sentinel hash mismatch");
    }
    const status = await this.getOnChainOrderStatus(hash, input);
    if (status.filled || status.remaining !== 0n) {
      throw new Error("Sentinel already has on-chain order status");
    }
    await this.checkBuyAllowance(order, input);
    const response = this.assertAccepted(await this.getReady().clobClient.postOrder(order));
    if (response.orderId.toLowerCase() !== hash.toLowerCase()) {
      throw new Error("CLOB returned an unexpected sentinel order ID");
    }
    if (input.postOnly && response.status !== "live") {
      throw new Error(`Post-only sentinel did not rest on the book: ${response.status}`);
    }
    return response;
  }

  private assertAccepted(response: Awaited<ReturnType<SecureClient["postOrder"]>>) {
    if (!response.ok) throw new Error(`Polymarket order rejected: ${response.message}`);
    if (!response.orderId) throw new Error("CLOB returned no order ID");
    return response;
  }
}

export const getPolymarketOrderService = () => PolymarketOrderService.getInstance();
