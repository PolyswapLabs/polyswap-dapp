import { getAddress, type Address } from "viem";
import { AssetType } from "@polymarket/client";
import { parseProtocolVersion, type ProtocolVersion } from "../../lib/polymarket/protocol";

export interface TradingContext {
  protocolVersion: ProtocolVersion;
  negRisk: boolean;
  /** Persisted on new sentinels so later configuration changes cannot reroute them. */
  exchangeAddress?: string | null;
}

function address(name: string, fallback: string): Address {
  return getAddress(process.env[name] || fallback);
}

export function getPolymarketContracts() {
  return {
    collateral: address("PUSD_ADDRESS", "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"),
    ctf: address("CTF_ADDRESS", "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"),
    ctfExchange: address("CTF_EXCHANGE_V2_ADDRESS", "0xE111180000d2663C0091e4f400237545B87B996B"),
    negRiskExchange: address(
      "NEG_RISK_CTF_EXCHANGE_V2_ADDRESS",
      "0xe2222d279d744050d28e00520010520000310F59"
    ),
    exchangeV3: address(
      "POLYMARKET_EXCHANGE_V3_ADDRESS",
      "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa"
    ),
    positionManager: address(
      "POLYMARKET_POSITION_MANAGER_ADDRESS",
      "0x006F54F7f9A22e0000CC2AB60031000000ae9fEF"
    ),
  };
}

export function getTradingConfig(context: TradingContext) {
  const version = parseProtocolVersion(context.protocolVersion);
  const contracts = getPolymarketContracts();
  return {
    exchange: context.exchangeAddress
      ? getAddress(context.exchangeAddress)
      : version === "v2"
        ? contracts.exchangeV3
        : context.negRisk
          ? contracts.negRiskExchange
          : contracts.ctfExchange,
    ledger: version === "v2" ? contracts.positionManager : contracts.ctf,
    domainVersion: version === "v2" ? "3" : "2",
    assetType: version === "v2" ? AssetType.CONDITIONAL_V2 : AssetType.CONDITIONAL,
  } as const;
}

export function getPolyswapHandlerAddress(context: TradingContext): Address {
  const version = parseProtocolVersion(context.protocolVersion);
  const name =
    version === "v2"
      ? "NEXT_PUBLIC_POLYSWAP_HANDLER_V2"
      : context.negRisk
        ? "NEXT_PUBLIC_POLYSWAP_HANDLER_NEGRISK"
        : "NEXT_PUBLIC_POLYSWAP_HANDLER";
  const value = process.env[name];
  if (!value || /^0x0{40}$/i.test(value)) {
    throw new Error(`${name} must be configured before trading this market`);
  }
  return getAddress(value);
}

export function getAcceptedPolyswapHandlers(): Address[] {
  return [
    "NEXT_PUBLIC_POLYSWAP_HANDLER",
    "NEXT_PUBLIC_POLYSWAP_HANDLER_NEGRISK",
    "NEXT_PUBLIC_POLYSWAP_HANDLER_V2",
  ].flatMap((name) => {
    const value = process.env[name];
    return value ? [getAddress(value)] : [];
  });
}
