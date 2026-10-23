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

const TRANSFER_SINGLE = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
);
const TRANSFER_BATCH = parseAbiItem(
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)"
);

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

  async read(
    options: {
      onApiError?: (error: unknown) => void;
      onScanError?: (error: unknown, protocolVersion?: ProtocolVersion) => void;
      lookbackBlocks?: bigint;
    } = {}
  ): Promise<InventoryPosition[]> {
    let positions: PolymarketPosition[];
    try {
      positions = await this.data.fetchPositions(this.owner);
    } catch (error) {
      if (!options.onApiError) throw error;
      options.onApiError(error);
      positions = [];
    }
    const metadata = new Map(positions.map((position) => [position.assetId, position]));
    const currentBlock = await this.client.getBlockNumber().catch((error: unknown) => {
      options.onScanError?.(error);
      return undefined;
    });
    const lookback = options.lookbackBlocks ?? 2000n;
    const fromBlock =
      currentBlock !== undefined && currentBlock > lookback ? currentBlock - lookback : 0n;
    const inventories = await Promise.all(
      PROTOCOL_VERSIONS.map(async (protocolVersion) => {
        const ledger = getTradingConfig({ protocolVersion, negRisk: false }).ledger;
        // API IDs are checked in both ledgers; a market's current version cannot
        // identify the ledger of an existing holding after a position migration.
        const ids = new Set(metadata.keys());
        if (currentBlock !== undefined) {
          const [single, batch] = await Promise.allSettled([
            this.client.getLogs({
              address: ledger,
              event: TRANSFER_SINGLE,
              args: { to: this.owner },
              fromBlock,
              toBlock: currentBlock,
            }),
            this.client.getLogs({
              address: ledger,
              event: TRANSFER_BATCH,
              args: { to: this.owner },
              fromBlock,
              toBlock: currentBlock,
            }),
          ]);
          // Supplementary discovery must not discard API inventory or successful
          // scans in this ledger or the other ledger when one log request fails.
          if (single.status === "fulfilled") {
            for (const log of single.value) {
              if (typeof log.args.id === "bigint") ids.add(log.args.id.toString());
            }
          } else {
            options.onScanError?.(single.reason, protocolVersion);
          }
          if (batch.status === "fulfilled") {
            for (const log of batch.value)
              for (const id of log.args.ids ?? []) ids.add(id.toString());
          } else {
            options.onScanError?.(batch.reason, protocolVersion);
          }
        }
        const result: InventoryPosition[] = [];
        // Bound RPC concurrency for large portfolios.
        const assets = [...ids];
        for (let offset = 0; offset < assets.length; offset += 10) {
          const balances = await Promise.all(
            assets.slice(offset, offset + 10).map(async (assetId) => ({
              assetId,
              protocolVersion,
              balance: await this.balance(assetId, protocolVersion),
              metadata: metadata.get(assetId),
            }))
          );
          result.push(...balances.filter((position) => position.balance > 0n));
        }
        return result;
      })
    );
    return inventories.flat();
  }
}

export function sharesFromBalance(balance: bigint): string {
  return formatUnits(balance, 6);
}
