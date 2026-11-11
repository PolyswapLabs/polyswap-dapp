import type { Address, Hex } from "viem";

export function requireAddress(envName: string): Address {
  const value = process.env[envName];
  if (!value) throw new Error(`${envName} is not set`);
  return value as Address;
}

/** Returns the fallback when the variable is unset or is not a positive integer. */
export function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function toPrivateKeyHex(privateKey: string): Hex {
  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
}
