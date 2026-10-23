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

export interface TransactionData {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

// Canonical Polygon ComposableCoW deployment address
const COMPOSABLE_COW_ADDRESS: Address = getAddress(
  process.env.COMPOSABLE_COW ?? "0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74"
);

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

const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? "137");

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

    // Field order must exactly match the on-chain PolyswapOrderData struct layout.
    return encodeAbiParameters(
      [
        { type: "address" }, // sellToken
        { type: "address" }, // buyToken
        { type: "address" }, // receiver
        { type: "uint256" }, // sellAmount
        { type: "uint256" }, // minBuyAmount
        { type: "uint256" }, // t0
        { type: "uint256" }, // t
        { type: "bytes32" }, // polymarketOrderHash
        { type: "bytes32" }, // appData
        { type: "uint256" }, // polymarketMakerAmount
      ],
      [
        sellToken,
        buyToken,
        receiver,
        toBigInt(orderData.sellAmount || "0", "sellAmount"),
        toBigInt(orderData.minBuyAmount || "0", "minBuyAmount"),
        toBigInt(orderData.t0 || "0", "t0"),
        toBigInt(orderData.t || "0", "t"),
        formatBytes32(orderData.polymarketOrderHash),
        formatBytes32(
          orderData.appData || "0x0000000000000000000000000000000000000000000000000000000000000000"
        ),
        toBigInt(orderData.polymarketMakerAmount, "polymarketMakerAmount"),
      ]
    );
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

  static createTransaction(
    orderData: PolyswapOrderData,
    options: TradingContext & { salt?: string }
  ): TransactionData {
    const params = this.createConditionalOrderParams(orderData, options);
    const callData = this.encodeCreateWithContextCallData(params);

    return {
      to: COMPOSABLE_COW_ADDRESS,
      data: callData,
      value: "0",
      chainId: CHAIN_ID,
    };
  }

  static encodeSetFallbackHandlerCalldata(handler: Address): Hex {
    return encodeFunctionData({
      abi: SAFE_SET_FALLBACK_HANDLER_ABI,
      functionName: "setFallbackHandler",
      args: [getAddress(handler)],
    });
  }

  static calculateOrderHash(params: ConditionalOrderParams): string {
    const encoded = encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "handler", type: "address" },
            { name: "salt", type: "bytes32" },
            { name: "staticInput", type: "bytes" },
          ],
        },
      ],
      [
        {
          handler: params.handler as Address,
          salt: params.salt as Hex,
          staticInput: params.staticInput as Hex,
        },
      ]
    );

    return keccak256(encoded);
  }
}
