import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  maxUint256,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { resilientHttp } from "@/lib/rpc/resilientHttp";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { AssetType } from "@polymarket/clob-client-v2";
import { getPolymarketOrderService } from "./polymarketOrderService";
import { DatabaseService } from "./databaseService";
import { createLogger } from "../logger";
import { getRetryAt, sleep } from "../utils/httpRetry";

const log = createLogger("position-seller");

// Polymarket Data API endpoint for positions
const POSITIONS_API_URL = "https://data-api.polymarket.com/positions";
const POSITIONS_MAX_ATTEMPTS = 3;
const POSITIONS_RETRY_BASE_MS = 1_000;
const POSITIONS_MAX_INLINE_RETRY_MS = 10_000;
const POSITIONS_RATE_LIMIT_COOLDOWN_MS = 60_000;

class PositionsRateLimitError extends Error {
  constructor(
    readonly retryAt: number,
    responseBody: string
  ) {
    super(
      `Positions API rate limited; retry after ${new Date(retryAt).toISOString()}` +
        (responseBody ? `; body=${responseBody}` : "")
    );
  }
}

// Polymarket V2 contract addresses on Polygon (cutover 2026-04-28).
// See: https://docs.polymarket.com/resources/contracts
const PUSD_ADDRESS: Address =
  (process.env.PUSD_ADDRESS as Address) ?? "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"; // pUSD collateral (6 decimals)
const CTF_ADDRESS: Address =
  (process.env.CTF_ADDRESS as Address) ?? "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"; // Conditional Token Framework (ERC1155, unchanged in V2)
const CTF_EXCHANGE: Address =
  (process.env.CTF_EXCHANGE_V2_ADDRESS as Address) ?? "0xE111180000d2663C0091e4f400237545B87B996B"; // V2 CTFExchange
const NEG_RISK_CTF_EXCHANGE: Address =
  (process.env.NEG_RISK_CTF_EXCHANGE_V2_ADDRESS as Address) ??
  "0xe2222d279d744050d28e00520010520000310F59"; // V2 NegRiskCtfExchange
const NEG_RISK_ADAPTER: Address =
  (process.env.NEG_RISK_ADAPTER_ADDRESS as Address) ?? "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296"; // NegRiskAdapter

// ERC1155 ABI for approval and balance checking (viem JSON form)
const ERC1155_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

// CTF ERC1155 TransferSingle event (used to scan recent inbound transfers)
const TRANSFER_SINGLE_EVENT = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
);

// Position interface matching Polymarket API response
interface PolymarketPosition {
  proxyWallet: string;
  asset: string; // This is the tokenId
  conditionId: string;
  size: number; // This is the quantity
  avgPrice: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number; // Current price
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string; // Outcome name (Yes/No)
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

/**
 * Service to automatically sell Polymarket positions
 * This prevents the system from holding risk after BUY orders are executed
 */
export class PolymarketPositionSellerService {
  private static sellInterval: NodeJS.Timeout | null = null;
  private static isSelling = false;
  private static ownerAddress: Address | null = null;
  private static publicClient: PublicClient | null = null;
  private static walletClient: WalletClient | null = null;
  private static ctfApproved = false;
  private static positionsBlockedUntil = 0;

  /**
   * Initialize the service and derive owner address from private key
   */
  private static async initialize(): Promise<void> {
    if (this.ownerAddress && this.publicClient && this.walletClient) return;

    const pk = process.env.PK;
    if (!pk) {
      throw new Error("Private key (PK) is not set in environment variables");
    }

    const rpcUrl = process.env.RPC_URL || "https://polygon-rpc.com";
    const privateKey: Hex = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
    const account = privateKeyToAccount(privateKey);

    this.publicClient = createPublicClient({
      chain: polygon,
      transport: resilientHttp(rpcUrl),
    });
    this.walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: resilientHttp(rpcUrl),
    });
    this.ownerAddress = account.address;

    log.info(`Initialized with address: ${this.ownerAddress}`);

    // Clean up any failed sold position records from previous runs
    await DatabaseService.cleanupFailedSoldPositions();

    // Ensure CTF tokens are approved for selling
    await this.ensureCTFApproval();
  }

  /**
   * Check and approve CTF tokens for all Polymarket exchange contracts
   * This is required to be able to SELL positions
   */
  private static async ensureCTFApproval(): Promise<void> {
    if (this.ctfApproved || !this.walletClient || !this.publicClient || !this.ownerAddress) return;

    log.info("Checking CTF token approvals...");

    // All positions use the main CTF contract (ERC1155)
    // The NegRisk system uses the same CTF contract but with different exchange contracts
    const operators: Array<{ name: string; address: Address }> = [
      { name: "CTFExchange", address: CTF_EXCHANGE },
      { name: "NegRiskCtfExchange", address: NEG_RISK_CTF_EXCHANGE },
      { name: "NegRiskAdapter", address: NEG_RISK_ADAPTER },
    ];

    let allApproved = true;

    for (const operator of operators) {
      try {
        const isApproved = await this.publicClient.readContract({
          address: CTF_ADDRESS,
          abi: ERC1155_ABI,
          functionName: "isApprovedForAll",
          args: [this.ownerAddress, operator.address],
        });

        if (isApproved) {
          log.info(`CTF already approved for ${operator.name}`);
        } else {
          log.info(`Approving CTF for ${operator.name}...`);
          const txHash = await this.walletClient.writeContract({
            account: this.walletClient.account!,
            chain: polygon,
            address: CTF_ADDRESS,
            abi: ERC1155_ABI,
            functionName: "setApprovalForAll",
            args: [operator.address, true],
          });
          log.info(`TX: ${txHash}`);
          await this.publicClient.waitForTransactionReceipt({ hash: txHash });
          log.info(`CTF approved for ${operator.name}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Error approving CTF for ${operator.name}:`, message);
        allApproved = false;
      }
    }

    // Also ensure pUSD is approved for the V2 exchanges (required for settlements)
    await this.ensurePUSDApproval();

    this.ctfApproved = allApproved;
    if (allApproved) {
      log.info("All CTF approvals verified");

      // Sync the CLOB's view of our balance/allowance with on-chain state
      await this.syncCLOBAllowance();
    } else {
      log.warn("Some CTF approvals may have failed - selling may not work");
    }
  }

  /**
   * Ensure pUSD is approved for the V2 exchange contracts (required by Polymarket).
   * V2 settles in pUSD; USDC.e is no longer used as collateral directly.
   */
  private static async ensurePUSDApproval(): Promise<void> {
    if (!this.walletClient || !this.publicClient || !this.ownerAddress) return;

    log.info("Checking pUSD approvals...");

    // Contracts that need pUSD approval to pull collateral on settlement.
    const spenders: Array<{ name: string; address: Address }> = [
      { name: "CTF Contract", address: CTF_ADDRESS },
      { name: "CTFExchange", address: CTF_EXCHANGE },
      { name: "NegRiskCtfExchange", address: NEG_RISK_CTF_EXCHANGE },
      { name: "NegRiskAdapter", address: NEG_RISK_ADAPTER },
    ];

    for (const spender of spenders) {
      try {
        const currentAllowance = await this.publicClient.readContract({
          address: PUSD_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [this.ownerAddress, spender.address],
        });

        if (currentAllowance > 0n) {
          continue; // Already approved
        }

        log.info(`Approving pUSD for ${spender.name}...`);
        const txHash = await this.walletClient.writeContract({
          account: this.walletClient.account!,
          chain: polygon,
          address: PUSD_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender.address, maxUint256],
        });
        log.info(`TX: ${txHash}`);
        await this.publicClient.waitForTransactionReceipt({ hash: txHash });
        log.info(`pUSD approved for ${spender.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Error approving pUSD for ${spender.name}:`, message);
      }
    }
  }

  /**
   * Sync the CLOB's internal balance/allowance with on-chain state
   * This is required after approving CTF tokens
   */
  private static async syncCLOBAllowance(): Promise<void> {
    try {
      log.info("Syncing CLOB balance/allowance with on-chain state...");

      const polymarketService = getPolymarketOrderService();
      await polymarketService.initialize();

      const client = polymarketService.getClient();
      if (!client) {
        log.warn("Could not get CLOB client for sync");
        return;
      }

      // Check current balance/allowance for conditional tokens
      try {
        const conditionalStatus = await client.getBalanceAllowance({
          asset_type: AssetType.CONDITIONAL,
        });
        log.info(
          `Conditional tokens - Balance: ${conditionalStatus.balance}, Allowances: ${JSON.stringify(conditionalStatus.allowances)}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.info(`Could not check conditional balance: ${message}`);
      }

      // Check current balance/allowance for collateral (pUSD)
      try {
        const collateralStatus = await client.getBalanceAllowance({
          asset_type: AssetType.COLLATERAL,
        });
        log.info(
          `Collateral (pUSD) - Balance: ${collateralStatus.balance}, Allowances: ${JSON.stringify(collateralStatus.allowances)}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.info(`Could not check collateral balance: ${message}`);
      }

      log.info("CLOB balance/allowance checked");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("Warning: Failed to sync CLOB allowance:", message);
    }
  }

  /**
   * Check the on-chain CTF token balance for a specific token ID
   */
  private static async getOnChainBalance(tokenId: string): Promise<bigint> {
    if (!this.publicClient || !this.ownerAddress) {
      return 0n;
    }

    try {
      const balance = await this.publicClient.readContract({
        address: CTF_ADDRESS,
        abi: ERC1155_ABI,
        functionName: "balanceOf",
        args: [this.ownerAddress, BigInt(tokenId)],
      });
      return balance;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Error checking on-chain balance:`, message);
      return 0n;
    }
  }

  /**
   * Start the position selling routine with specified interval
   * @param intervalMinutes Interval in minutes (default: 5)
   */
  static async startSellRoutine(intervalMinutes: number = 5): Promise<void> {
    if (this.sellInterval) {
      log.info("Sell routine already running");
      return;
    }

    try {
      await this.initialize();
    } catch (error) {
      log.error("Failed to initialize:", error);
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    log.info(`Starting position sell routine (${intervalMinutes} min interval)`);

    // Run immediately on start
    this.checkAndSellPositions();

    // Then run on interval
    this.sellInterval = setInterval(() => {
      this.checkAndSellPositions();
    }, intervalMs);
  }

  /**
   * Stop the position selling routine
   */
  static stopSellRoutine(): void {
    if (this.sellInterval) {
      clearInterval(this.sellInterval);
      this.sellInterval = null;
      log.info("Sell routine stopped");
    }
  }

  /**
   * Fetch positions from Polymarket API
   */
  private static async fetchPositions(): Promise<PolymarketPosition[]> {
    if (!this.ownerAddress) {
      throw new Error("Owner address not initialized");
    }

    for (let attempt = 1; attempt <= POSITIONS_MAX_ATTEMPTS; attempt++) {
      const url = `${POSITIONS_API_URL}?user=${this.ownerAddress}`;
      const response = await fetch(url, { method: "GET" });

      if (response.ok) {
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error("Positions API returned an invalid response");
        return payload as PolymarketPosition[];
      }

      const responseBody = (await response.text()).slice(0, 1_000);
      if (response.status !== 429) {
        throw new Error(
          `Positions API returned HTTP ${response.status} ${response.statusText}` +
            (responseBody ? `; body=${responseBody}` : "")
        );
      }

      const now = Date.now();
      const retryAt = getRetryAt(
        response.headers.get("retry-after"),
        now,
        POSITIONS_RETRY_BASE_MS * 2 ** (attempt - 1)
      );
      this.positionsBlockedUntil = Math.max(this.positionsBlockedUntil, retryAt);
      const delayMs = this.positionsBlockedUntil - now;

      if (attempt < POSITIONS_MAX_ATTEMPTS && delayMs <= POSITIONS_MAX_INLINE_RETRY_MS) {
        log.debug(
          `Positions API rate limited (attempt ${attempt}/${POSITIONS_MAX_ATTEMPTS}); retrying in ${delayMs}ms`
        );
        await sleep(delayMs);
        continue;
      }

      this.positionsBlockedUntil = Math.max(
        this.positionsBlockedUntil,
        now + POSITIONS_RATE_LIMIT_COOLDOWN_MS
      );
      throw new PositionsRateLimitError(this.positionsBlockedUntil, responseBody);
    }

    throw new Error("Positions API retry loop exhausted unexpectedly");
  }

  /**
   * Get open SELL orders from the CLOB to avoid creating duplicates
   * This replaces the database-based "recently sold" check
   */
  private static async getOpenSellOrderTokenIds(): Promise<Set<string>> {
    const tokenIds = new Set<string>();

    try {
      const polymarketService = getPolymarketOrderService();
      await polymarketService.initialize();

      const client = polymarketService.getClient();
      if (!client) return tokenIds;

      const openOrders = await client.getOpenOrders({});

      // Filter for SELL orders and extract token IDs
      for (const order of openOrders) {
        if (order.side === "SELL") {
          tokenIds.add(order.asset_id);
        }
      }

      log.info(`Found ${tokenIds.size} tokens with open SELL orders`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Could not fetch open orders: ${message}`);
    }

    return tokenIds;
  }

  /**
   * Check for open positions and sell them
   * This version relies ONLY on API and blockchain data, NOT the database
   */
  static async checkAndSellPositions(): Promise<void> {
    if (this.isSelling) {
      log.info("Already selling, skipping...");
      return;
    }

    this.isSelling = true;
    const startTime = Date.now();

    try {
      if (this.positionsBlockedUntil > Date.now()) {
        log.debug(
          `Positions API cooldown active until ${new Date(this.positionsBlockedUntil).toISOString()}; skipping pass`
        );
        return;
      }

      log.info("Checking for positions to sell...");

      // Initialize the Polymarket order service first
      const polymarketService = getPolymarketOrderService();
      await polymarketService.initialize();

      if (!polymarketService.isReady()) {
        throw new Error("Polymarket service is not ready");
      }

      // Fetch current positions from Polymarket API
      const positions = await this.fetchPositions();
      log.info(`Positions API returned ${positions.length} position(s)`);

      // Get tokens that already have open SELL orders (from CLOB API, not database)
      const tokensWithOpenSellOrders = await this.getOpenSellOrderTokenIds();

      // Also scan on-chain for CTF token balances that might not be in the API yet
      // This catches recently filled orders that haven't been indexed
      const onChainPositions = await this.scanOnChainPositions();
      log.info(`On-chain scan found ${onChainPositions.length} position(s)`);

      // Merge positions - use on-chain data as source of truth for balances
      const allPositions = this.mergePositions(positions, onChainPositions);

      if (allPositions.length === 0) {
        log.info("No positions found");
        return;
      }

      log.info(`Total unique positions to process: ${allPositions.length}`);

      let soldCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const position of allPositions) {
        try {
          // Skip if no shares to sell
          if (position.size <= 0) {
            skippedCount++;
            continue;
          }

          // Skip if price is zero (can't sell) - but only if we got price from API
          if (position.curPrice <= 0 && position.fromAPI) {
            skippedCount++;
            continue;
          }

          // Skip if there's already an open SELL order for this token (from CLOB API)
          if (tokensWithOpenSellOrders.has(position.asset)) {
            skippedCount++;
            continue;
          }

          // Get the actual on-chain balance
          const onChainBalance = await this.getOnChainBalance(position.asset);
          const onChainBalanceNum = Number(onChainBalance) / 1e6; // CTF tokens have 6 decimals

          if (onChainBalance === 0n) {
            log.info(
              `Skipping ${position.outcome}: No on-chain balance (API shows ${position.size})`
            );
            skippedCount++;
            continue;
          }

          // Calculate sell price - use current price if available, otherwise try to get from orderbook
          let sellPrice: number;
          if (position.curPrice > 0) {
            sellPrice = Math.max(0.01, position.curPrice * 0.95);
          } else {
            // Try to get price from orderbook
            const midPrice = await this.getMidpointPrice(position.asset);
            if (midPrice <= 0) {
              log.info(`Skipping ${position.outcome}: Could not determine price`);
              skippedCount++;
              continue;
            }
            sellPrice = Math.max(0.01, midPrice * 0.95);
          }

          // Use the on-chain balance
          const sizeToSell = onChainBalanceNum;

          log.info(
            `Selling ${sizeToSell.toFixed(2)} shares of "${position.outcome}" at $${sellPrice.toFixed(3)}`
          );

          // Create the sell order
          const orderResult = await polymarketService.postGTCOrder({
            tokenID: position.asset,
            price: sellPrice,
            side: "SELL",
            size: sizeToSell,
          });

          // Verify the order was actually created successfully
          const orderId = orderResult.response?.orderID;

          if (!orderId || orderId === "unknown") {
            log.error(`Failed to create sell order for ${position.outcome} - no order ID returned`);
            errorCount++;
            continue;
          }

          log.info(`Sell order created: ${orderId}`);

          try {
            await DatabaseService.recordSoldPosition({
              assetId: position.asset,
              conditionId: position.conditionId || "",
              size: sizeToSell,
              sellPrice,
              currentPrice: position.curPrice,
              orderId,
              marketTitle: position.title || "Unknown",
              outcome: position.outcome || "Unknown",
            });
          } catch (err) {
            log.warn(
              `Failed to record sale in DB (audit only): ${err instanceof Error ? err.message : String(err)}`
            );
          }

          soldCount++;

          // Small delay between orders to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          log.error(`Error selling position ${position.outcome}:`, error);
          errorCount++;
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      log.info(
        `Completed: ${soldCount} sold, ${skippedCount} skipped, ${errorCount} errors (${duration.toFixed(1)}s)`
      );
    } catch (error) {
      if (error instanceof PositionsRateLimitError) {
        log.warn(error.message);
      } else {
        log.error("Error in checkAndSellPositions:", error);
      }
    } finally {
      this.isSelling = false;
    }
  }

  /**
   * Get midpoint price for a token from the orderbook
   */
  private static async getMidpointPrice(tokenId: string): Promise<number> {
    try {
      const polymarketService = getPolymarketOrderService();
      const client = polymarketService.getClient();
      if (!client) return 0;

      const midpoint = await client.getMidpoint(tokenId);
      return parseFloat(midpoint?.mid || "0");
    } catch {
      return 0;
    }
  }

  /**
   * Scan on-chain for CTF token balances using recent transfer events
   * This catches positions that might not be in the Positions API yet
   */
  private static async scanOnChainPositions(): Promise<
    Array<PolymarketPosition & { fromAPI: boolean }>
  > {
    if (!this.publicClient || !this.ownerAddress) return [];

    const positions: Array<PolymarketPosition & { fromAPI: boolean }> = [];

    try {
      // Get recent transfer events to our address (last ~1000 blocks ≈ 30 mins on Polygon)
      const currentBlock = await this.publicClient.getBlockNumber();
      const fromBlock = currentBlock - 1000n;

      const logs = await this.publicClient.getLogs({
        address: CTF_ADDRESS,
        event: TRANSFER_SINGLE_EVENT,
        args: {
          to: this.ownerAddress,
        },
        fromBlock,
        toBlock: currentBlock,
      });

      log.info(`Found ${logs.length} recent transfer events to wallet`);

      // Get unique token IDs from events
      const tokenIds = new Set<string>();
      for (const log of logs) {
        const id = log.args.id;
        if (typeof id === "bigint") {
          tokenIds.add(id.toString());
        }
      }

      // Check current balance for each token
      for (const tokenId of tokenIds) {
        const balance = await this.getOnChainBalance(tokenId);
        if (balance > 0n) {
          const balanceNum = Number(balance) / 1e6;
          positions.push({
            proxyWallet: "",
            asset: tokenId,
            conditionId: "",
            size: balanceNum,
            avgPrice: 0,
            currentValue: 0,
            cashPnl: 0,
            percentPnl: 0,
            curPrice: 0, // Will try to get from orderbook
            title: `Token ${tokenId.slice(0, 20)}...`,
            slug: "",
            icon: "",
            eventSlug: "",
            outcome: `Token ${tokenId.slice(0, 10)}...`,
            outcomeIndex: 0,
            oppositeOutcome: "",
            oppositeAsset: "",
            endDate: "",
            negativeRisk: false,
            fromAPI: false,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Error scanning on-chain positions: ${message}`);
    }

    return positions;
  }

  /**
   * Merge positions from API and on-chain, using on-chain balance as source of truth
   */
  private static mergePositions(
    apiPositions: PolymarketPosition[],
    onChainPositions: Array<PolymarketPosition & { fromAPI: boolean }>
  ): Array<PolymarketPosition & { fromAPI: boolean }> {
    const positionMap = new Map<string, PolymarketPosition & { fromAPI: boolean }>();

    // Add API positions first (they have metadata like title, outcome, price)
    for (const pos of apiPositions) {
      positionMap.set(pos.asset, { ...pos, fromAPI: true });
    }

    // Merge/add on-chain positions
    for (const pos of onChainPositions) {
      const existing = positionMap.get(pos.asset);
      if (existing) {
        // Update size from on-chain if different
        if (pos.size !== existing.size) {
          log.info(
            `Balance mismatch for ${pos.asset.slice(0, 20)}: API=${existing.size}, on-chain=${pos.size}`
          );
          existing.size = pos.size; // Use on-chain balance
        }
      } else {
        // New position only found on-chain
        positionMap.set(pos.asset, pos);
      }
    }

    return Array.from(positionMap.values());
  }

  /**
   * Manually trigger a position check and sell
   */
  static async triggerSell(): Promise<void> {
    await this.initialize();
    await this.checkAndSellPositions();
  }

  /**
   * Get the current status of the sell routine
   */
  static getStatus(): {
    isRunning: boolean;
    isSelling: boolean;
    ownerAddress: Address | null;
  } {
    return {
      isRunning: this.sellInterval !== null,
      isSelling: this.isSelling,
      ownerAddress: this.ownerAddress,
    };
  }
}
