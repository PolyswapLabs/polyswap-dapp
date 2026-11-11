import "dotenv/config";
import { createSecureClient, forkEnvironmentConfig } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { privateKeyToAccount } from "viem/accounts";
import { toPrivateKeyHex } from "../src/backend/utils/env";

const pk = process.env.PK;
if (!pk) throw new Error("Private key (PK) is not configured");
const key = toPrivateKeyHex(pk);
const client = await createSecureClient({
  wallet: privateKeyToAccount(key).address,
  signer: privateKey(key),
  nonce: Number(process.env.NONCE ?? 0),
  environment: forkEnvironmentConfig({
    name: "polyswap-polygon",
    clob: { rest: process.env.CLOB_API_URL ?? "https://clob.polymarket.com" },
  }),
});
// Explicit credential-generation command. Never invoked by builds or migration checks.
process.stdout.write(`${JSON.stringify(client.credentials, null, 2)}\n`);
