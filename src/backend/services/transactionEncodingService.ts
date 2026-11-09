import { getPolyswapHandlerAddress, type TradingContext } from "../polymarket/config";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { type PolyswapOrderData, type ConditionalOrderParams } from "../interfaces/PolyswapOrder";
import composableCowAbi from "../../abi/composableCoW.json";
import { encodeStaticInput } from "../utils/conditionalOrderCodec";

const VALUE_FACTORY_ADDRESS: Address = getAddress(
  process.env.VALUE_FACTORY ?? "0x52eD56Da04309Aca4c3FECC595298d80C2f16BAc"
);

// Minimal Safe FallbackManager ABI — only the function the dApp needs to encode.
// `setFallbackHandler` carries the `authorized` modifier on Safe so it can only
// be invoked via a self-call through `execTransaction`. The dApp encodes the
// inner call; Safe Wallet wraps it into the multisig tx.
const SAFE_SET_FALLBACK_HANDLER_ABI = [
  {
    type: "function",
    name: "setFallbackHandler",
    stateMutability: "nonpayable",
    inputs: [{ name: "handler", type: "address" }],
    outputs: [],
  },
] as const;

// Normalise a hex string to a valid bytes32 Hex value.
// On-chain the polymarketOrderHash and appData are bytes32 slots, so they
// must be exactly 32 bytes (66 hex chars including the 0x prefix).
function formatBytes32(value: string): Hex {
  if (!value || value === "") {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  const stripped = value.startsWith("0x") ? value.slice(2) : value;
  if (stripped.length > 64) {
    throw new Error(`bytes32 value too long: ${value.length} chars (max 66 with 0x prefix)`);
  }
  return `0x${stripped.padStart(64, "0")}` as Hex;
}

function toBigInt(value: string, field: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`PolyswapOrderData.${field} is not a valid integer string: ${value}`);
  }
}

export class TransactionEncodingService {
  static encodePolyswapOrderData(orderData: PolyswapOrderData): string {
    if (!orderData.sellToken || !orderData.buyToken || !orderData.polymarketOrderHash) {
      throw new Error(
        "Missing required order data fields: sellToken, buyToken, or polymarketOrderHash"
      );
    }
    if (!orderData.polymarketMakerAmount) {
      throw new Error("Missing required order data field: polymarketMakerAmount");
    }

    const sellToken = orderData.sellToken as Address;
    const buyToken = orderData.buyToken as Address;
    const receiver = (orderData.receiver ||
      "0x0000000000000000000000000000000000000000") as Address;

    return encodeStaticInput({
      sellToken,
      buyToken,
      receiver,
      sellAmount: toBigInt(orderData.sellAmount || "0", "sellAmount"),
      minBuyAmount: toBigInt(orderData.minBuyAmount || "0", "minBuyAmount"),
      t0: toBigInt(orderData.t0 || "0", "t0"),
      t: toBigInt(orderData.t || "0", "t"),
      polymarketOrderHash: formatBytes32(orderData.polymarketOrderHash),
      appData: formatBytes32(
        orderData.appData || "0x0000000000000000000000000000000000000000000000000000000000000000"
      ),
      polymarketMakerAmount: toBigInt(orderData.polymarketMakerAmount, "polymarketMakerAmount"),
    });
  }

  static createConditionalOrderParams(
    orderData: PolyswapOrderData,
    options: TradingContext & { salt?: string }
  ): ConditionalOrderParams {
    const orderSalt =
      options.salt ??
      keccak256(
        encodeAbiParameters(
          [{ type: "string" }, { type: "uint256" }],
          ["Polyswap", BigInt(Date.now())]
        )
      );

    const staticInput = this.encodePolyswapOrderData(orderData);

    return {
      handler: getPolyswapHandlerAddress(options),
      salt: orderSalt,
      staticInput,
    };
  }

  static encodeCreateWithContextCallData(
    params: ConditionalOrderParams,
    valueFactory: Address = VALUE_FACTORY_ADDRESS,
    data: Hex = "0x",
    dispatch: boolean = true
  ): string {
    return encodeFunctionData({
      abi: composableCowAbi,
      functionName: "createWithContext",
      args: [params, valueFactory, data, dispatch],
    });
  }

  static encodeSetFallbackHandlerCalldata(handler: Address): Hex {
    return encodeFunctionData({
      abi: SAFE_SET_FALLBACK_HANDLER_ABI,
      functionName: "setFallbackHandler",
      args: [getAddress(handler)],
    });
  }
}
