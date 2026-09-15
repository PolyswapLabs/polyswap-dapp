#!/usr/bin/env tsx

/**
 * Generate, register, and verify a unique PolySwap AppData document.
 *
 * By default this targets the configured CoW Protocol Orderbook on Polygon.
 * Registration is off-chain and does not require a wallet or gas.
 *
 * Usage:
 *   pnpm register-cow-appdata
 *   pnpm register-cow-appdata -- --dry-run
 *   pnpm register-cow-appdata -- --environment development --nonce 0x...
 *   pnpm register-cow-appdata -- --api-base https://barn.api.cow.fi/polygon
 */

import type { Hex } from "viem";
import {
  CowAppDataService,
  type CowAppDataOptions,
} from "../src/backend/services/cowAppDataService.js";

interface CliOptions extends CowAppDataOptions {
  dryRun: boolean;
}

function usage(): string {
  return [
    "Usage: pnpm register-cow-appdata -- [options]",
    "",
    "Options:",
    "  --api-base <url>       CoW API base (default: configured Polygon API)",
    "  --app-code <name>      App code (default: PolySwap)",
    "  --environment <name>   Environment label",
    "  --nonce <bytes32>      Reuse a specific 0x-prefixed 32-byte nonce",
    "  --timeout-ms <number>  Timeout for each CoW API request",
    "  --dry-run              Generate and print without registering",
    "  --help                 Show this help",
  ].join("\n");
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseNonce(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("--nonce must be a 0x-prefixed 32-byte hexadecimal value");
  }
  return value.toLowerCase() as Hex;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--api-base":
        options.apiBase = readValue(args, index, arg);
        index += 1;
        break;
      case "--app-code":
        options.appCode = readValue(args, index, arg);
        index += 1;
        break;
      case "--environment":
        options.environment = readValue(args, index, arg);
        index += 1;
        break;
      case "--nonce":
        options.nonce = parseNonce(readValue(args, index, arg));
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(readValue(args, index, arg));
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const appData = CowAppDataService.create(options);

  console.log(`Nonce         ${appData.nonce}`);
  console.log(`AppData hash  ${appData.appDataHash}`);
  console.log(`Full AppData  ${appData.fullAppData}`);

  if (options.dryRun) {
    console.log("Dry run       not registered");
    return;
  }

  await CowAppDataService.registerAndConfirm(appData, options);
  console.log("Result        AppData registered and confirmed");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error         ${message}`);
  process.exitCode = 1;
});
