#!/usr/bin/env tsx

/**
 * Convert between USDC.e and pUSD on Polygon.
 *
 *   pnpm pusd wrap   [amount]    USDC.e -> pUSD   (default: full USDC.e balance)
 *   pnpm pusd unwrap [amount]    pUSD   -> USDC.e (default: full pUSD balance)
 *
 * `amount` is a human-readable decimal (e.g. "12.34"); both tokens have 6 decimals.
 *
 * Wrap goes through the CollateralOnramp; unwrap goes through the CollateralOfframp.
 * The pUSD token itself rejects direct wrap/unwrap from EOAs (Unauthorized()).
 *
 *   USDC.e --approve--> Onramp.wrap(asset, to, amount)   --mints--> pUSD
 *   pUSD   --approve--> Offramp.unwrap(asset, to, amount) --burns--> USDC.e
 */

import "dotenv/config";
import { resilientHttp } from "../src/shared/rpc/resilientHttp";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  parseUnits,
  maxUint256,
  type Address,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createLogger } from "../src/backend/logger.js";
import { toPrivateKeyHex } from "../src/backend/utils/env";

const log = createLogger("pusd");

const USDCE_ADDRESS = (process.env.USDCE_ADDRESS ??
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174") as Address;
const PUSD_ADDRESS = (process.env.PUSD_ADDRESS ??
  "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB") as Address;
const ONRAMP_ADDRESS = (process.env.COLLATERAL_ONRAMP_ADDRESS ??
  "0x93070a847efEf7F70739046A929D47a521F5B8ee") as Address;
const OFFRAMP_ADDRESS = (process.env.COLLATERAL_OFFRAMP_ADDRESS ??
  "0x2957922Eb93258b93368531d39fAcCA3B4dC5854") as Address;

const ONRAMP_ABI = [
  {
    type: "function",
    name: "wrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_asset", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const OFFRAMP_ABI = [
  {
    type: "function",
    name: "unwrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_asset", type: "address" },
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

type Direction = "wrap" | "unwrap";

interface Args {
  direction: Direction;
  amount: string | null;
}

function parseArgs(): Args {
  const [direction, amount] = process.argv.slice(2);
  if (direction !== "wrap" && direction !== "unwrap") {
    log.error("Usage: pnpm pusd <wrap|unwrap> [amount]");
    process.exit(1);
  }
  return { direction, amount: amount && amount.length > 0 ? amount : null };
}

async function ensureAllowance(args: {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  token: Address;
  spender: Address;
  required: bigint;
  label: string;
}): Promise<void> {
  const { publicClient, walletClient, account, token, spender, required, label } = args;

  const current = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, spender],
  });

  if (current >= required) {
    log.info(`Allowance OK (${label})`);
    return;
  }

  log.info(`Approving ${label} (max)...`);
  const txHash = await walletClient.writeContract({
    account,
    chain: polygon,
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
  });
  log.info(`  tx: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  log.info(`  approved`);
}

async function main(): Promise<void> {
  const { direction, amount } = parseArgs();

  const pk = process.env.PK;
  if (!pk) {
    log.error("Private key (PK) is not set in environment variables");
    process.exit(1);
  }

  const privateKey = toPrivateKeyHex(pk);
  const account = privateKeyToAccount(privateKey);
  const owner: Address = account.address;
  const rpcUrl = process.env.RPC_URL ?? "https://polygon-rpc.com";

  const publicClient = createPublicClient({ chain: polygon, transport: resilientHttp(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: resilientHttp(rpcUrl),
  });

  // For both directions, USDC.e is the underlying asset passed to the ramp contract;
  // the source-of-funds token (the one we hold and that gets debited) flips per direction.
  const sourceToken = direction === "wrap" ? USDCE_ADDRESS : PUSD_ADDRESS;
  const sourceLabel = direction === "wrap" ? "USDC.e" : "pUSD";
  const destLabel = direction === "wrap" ? "pUSD" : "USDC.e";
  const ramp = direction === "wrap" ? ONRAMP_ADDRESS : OFFRAMP_ADDRESS;
  const rampLabel = direction === "wrap" ? "CollateralOnramp" : "CollateralOfframp";

  const [decimals, balance] = await Promise.all([
    publicClient.readContract({
      address: sourceToken,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: sourceToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
  ]);

  log.info(`Owner       ${owner}`);
  log.info(`Direction   ${sourceLabel} -> ${destLabel}`);
  log.info(`Via         ${rampLabel} (${ramp})`);
  log.info(`Balance     ${formatUnits(balance, decimals)} ${sourceLabel}`);

  if (balance === 0n) {
    log.info(`Nothing to ${direction}.`);
    return;
  }

  const amountWei = amount === null ? balance : parseUnits(amount, decimals);
  if (amountWei <= 0n) {
    log.error("Amount must be positive");
    process.exit(1);
  }
  if (amountWei > balance) {
    log.error(
      `Requested ${formatUnits(amountWei, decimals)} ${sourceLabel} but balance is ${formatUnits(balance, decimals)}`
    );
    process.exit(1);
  }

  log.info(`Amount      ${formatUnits(amountWei, decimals)} ${sourceLabel}`);

  await ensureAllowance({
    publicClient,
    walletClient,
    account,
    token: sourceToken,
    spender: ramp,
    required: amountWei,
    label: `${sourceLabel} -> ${rampLabel}`,
  });

  // Both ramps take USDC.e as the asset argument — it's the canonical underlying.
  const args = [USDCE_ADDRESS, owner, amountWei] as const;

  log.info(`Sending ${direction}...`);
  const txHash =
    direction === "wrap"
      ? await walletClient.writeContract({
          account,
          chain: polygon,
          address: ramp,
          abi: ONRAMP_ABI,
          functionName: "wrap",
          args,
        })
      : await walletClient.writeContract({
          account,
          chain: polygon,
          address: ramp,
          abi: OFFRAMP_ABI,
          functionName: "unwrap",
          args,
        });
  log.info(`  tx: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  log.info(`  confirmed in block ${receipt.blockNumber}`);

  const [usdceAfter, pusdAfter] = await Promise.all([
    publicClient.readContract({
      address: USDCE_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
    publicClient.readContract({
      address: PUSD_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
  ]);

  log.info(`Final balances:`);
  log.info(`  USDC.e ${formatUnits(usdceAfter, 6)}`);
  log.info(`  pUSD   ${formatUnits(pusdAfter, 6)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("Failed:", err);
    process.exit(1);
  });
