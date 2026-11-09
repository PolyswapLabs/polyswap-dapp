import { erc1155Abi, formatUnits, parseAbiItem, type Address, type PublicClient } from "viem";
import { PROTOCOL_VERSIONS, type ProtocolVersion } from "../../lib/polymarket/protocol";
import { getTradingConfig } from "./config";
import { PolymarketDataClient, type PolymarketPosition } from "./data";

export interface InventoryPosition {
  assetId: string;
  protocolVersion: ProtocolVersion;
  balance: bigint;
  metadata?: PolymarketPosition;
}

interface InventoryReadOptions {
  onApiError?: (error: unknown) => void;
  onScanError?: (error: unknown, protocolVersion?: ProtocolVersion) => void;
  lookbackBlocks?: bigint;
  /** Resolved markets cannot be sold, so the seller spends no RPC calls on them. */
  skipRedeemable?: boolean;
}

const DEFAULT_LOOKBACK_BLOCKS = 2000n;
/** Bounds RPC concurrency for large portfolios. */
const BALANCE_READ_CONCURRENCY = 10;

export const TRANSFER_SINGLE = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
);
export const TRANSFER_BATCH = parseAbiItem(
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)"
);

export function getPositionLedgers(): Address[] {
  return PROTOCOL_VERSIONS.map(
    (protocolVersion) => getTradingConfig({ protocolVersion, negRisk: false }).ledger
  );
}

export function inventoryKey(protocol: ProtocolVersion, assetId: string): string {
  return `${protocol}:${assetId}`;
}

/** Read-only inventory shared by the seller and diagnostics; ledger balances are authoritative. */
export class PolymarketInventory {
  constructor(
    private readonly client: PublicClient,
    private readonly owner: Address,
    private readonly data = new PolymarketDataClient()
  ) {}

  async balance(assetId: string, protocolVersion: ProtocolVersion): Promise<bigint> {
    return this.client.readContract({
      address: getTradingConfig({ protocolVersion, negRisk: false }).ledger,
      abi: erc1155Abi,
      functionName: "balanceOf",
      args: [this.owner, BigInt(assetId)],
    });
  }

  async read(options: InventoryReadOptions = {}): Promise<InventoryPosition[]> {
    const positions = await this.fetchApiPositions(options.onApiError);
    const metadata = new Map(positions.map((position) => [position.assetId, position]));
    const skipped = new Set(
      options.skipRedeemable
        ? positions.filter((position) => position.redeemable).map((position) => position.assetId)
        : []
    );
    const currentBlock = await this.client.getBlockNumber().catch((error: unknown) => {
      options.onScanError?.(error);
      return undefined;
    });
    const lookback = options.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS;
    const fromBlock =
      currentBlock !== undefined && currentBlock > lookback ? currentBlock - lookback : 0n;

    const inventories = await Promise.all(
      PROTOCOL_VERSIONS.map(async (protocolVersion) => {
        const ledger = getTradingConfig({ protocolVersion, negRisk: false }).ledger;
        const received =
          currentBlock === undefined
            ? []
            : await this.scanReceivedAssetIds(ledger, fromBlock, currentBlock, (error) =>
                options.onScanError?.(error, protocolVersion)
              );
        // API IDs are checked in both ledgers; a market's current version cannot
        // identify the ledger of an existing holding after a position migration.
        const assets = [...new Set([...metadata.keys(), ...received])].filter(
          (assetId) => !skipped.has(assetId)
        );
        const held = await this.readNonZeroBalances(assets, protocolVersion);
        return held.map((position) => ({
          ...position,
          metadata: metadata.get(position.assetId),
        }));
      })
    );
    return inventories.flat();
  }

  private async fetchApiPositions(
    onApiError: InventoryReadOptions["onApiError"]
  ): Promise<PolymarketPosition[]> {
    try {
      return await this.data.fetchPositions(this.owner);
    } catch (error) {
      if (!onApiError) throw error;
      onApiError(error);
      return [];
    }
  }

  /**
   * Supplementary discovery: a failed log request is reported, never thrown, so it cannot
   * discard API inventory or the successful scans of either ledger.
   */
  private async scanReceivedAssetIds(
    ledger: Address,
    fromBlock: bigint,
    toBlock: bigint,
    onError: (error: unknown) => void
  ): Promise<string[]> {
    const range = { address: ledger, args: { to: this.owner }, fromBlock, toBlock };
    const [single, batch] = await Promise.allSettled([
      this.client.getLogs({ ...range, event: TRANSFER_SINGLE }),
      this.client.getLogs({ ...range, event: TRANSFER_BATCH }),
    ]);
    const ids: string[] = [];
    if (single.status === "fulfilled") {
      for (const log of single.value) {
        if (typeof log.args.id === "bigint") ids.push(log.args.id.toString());
      }
    } else {
      onError(single.reason);
    }
    if (batch.status === "fulfilled") {
      for (const log of batch.value) {
        for (const id of log.args.ids ?? []) ids.push(id.toString());
      }
    } else {
      onError(batch.reason);
    }
    return ids;
  }

  private async readNonZeroBalances(
    assets: string[],
    protocolVersion: ProtocolVersion
  ): Promise<InventoryPosition[]> {
    const held: InventoryPosition[] = [];
    for (let offset = 0; offset < assets.length; offset += BALANCE_READ_CONCURRENCY) {
      const balances = await Promise.all(
        assets.slice(offset, offset + BALANCE_READ_CONCURRENCY).map(async (assetId) => ({
          assetId,
          protocolVersion,
          balance: await this.balance(assetId, protocolVersion),
        }))
      );
      held.push(...balances.filter((position) => position.balance > 0n));
    }
    return held;
  }
}

export function sharesFromBalance(balance: bigint): string {
  return formatUnits(balance, 6);
}
