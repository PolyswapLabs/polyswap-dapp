import { decodeAbiParameters, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import {
  type ConditionalOrderParams,
  type PolyswapOrderData,
} from "@/backend/interfaces/PolyswapOrder";

/** Field order MUST match the handler's on-chain PolyswapOrderData struct. */
export const ORDER_DATA_LAYOUT = [
  { type: "address", name: "sellToken" },
  { type: "address", name: "buyToken" },
  { type: "address", name: "receiver" },
  { type: "uint256", name: "sellAmount" },
  { type: "uint256", name: "minBuyAmount" },
  { type: "uint256", name: "t0" },
  { type: "uint256", name: "t" },
  { type: "bytes32", name: "polymarketOrderHash" },
  { type: "bytes32", name: "appData" },
] as const;

export const ORDER_DATA_LAYOUT_V2 = [
  ...ORDER_DATA_LAYOUT,
  { type: "uint256", name: "polymarketMakerAmount" },
] as const;

// All fields are static (32 bytes); V1 staticInput = 288 bytes, V2 = 320.
const V2_BYTE_LENGTH = ORDER_DATA_LAYOUT_V2.length * 32;

interface StaticInputFields {
  sellToken: Address;
  buyToken: Address;
  receiver: Address;
  sellAmount: bigint;
  minBuyAmount: bigint;
  t0: bigint;
  t: bigint;
  polymarketOrderHash: Hex;
  appData: Hex;
  /** Null selects the legacy 9-field layout. */
  polymarketMakerAmount: bigint | null;
}

export function encodeStaticInput(fields: StaticInputFields): Hex {
  const base = [
    fields.sellToken,
    fields.buyToken,
    fields.receiver,
    fields.sellAmount,
    fields.minBuyAmount,
    fields.t0,
    fields.t,
    fields.polymarketOrderHash,
    fields.appData,
  ] as const;
  if (fields.polymarketMakerAmount === null) return encodeAbiParameters(ORDER_DATA_LAYOUT, base);
  return encodeAbiParameters(ORDER_DATA_LAYOUT_V2, [...base, fields.polymarketMakerAmount]);
}

export function decodeStaticInput(staticInput: Hex): PolyswapOrderData {
  const byteLength = (staticInput.length - 2) / 2;
  if (byteLength >= V2_BYTE_LENGTH) {
    const d = decodeAbiParameters(ORDER_DATA_LAYOUT_V2, staticInput);
    return { ...toOrderData(d), polymarketMakerAmount: d[9].toString() };
  }
  return {
    ...toOrderData(decodeAbiParameters(ORDER_DATA_LAYOUT, staticInput)),
    polymarketMakerAmount: "",
  };
}

function toOrderData(
  d: readonly [Address, Address, Address, bigint, bigint, bigint, bigint, Hex, Hex, ...unknown[]]
): Omit<PolyswapOrderData, "polymarketMakerAmount"> {
  return {
    sellToken: d[0],
    buyToken: d[1],
    receiver: d[2],
    sellAmount: d[3].toString(),
    minBuyAmount: d[4].toString(),
    t0: d[5].toString(),
    t: d[6].toString(),
    polymarketOrderHash: d[7],
    appData: d[8],
  };
}

/**
 * keccak256(abi.encode((handler, salt, staticInput))) — matches ComposableCoW.hash().
 * The result is the singleOrderHash key used for remove() and on-chain singleOrders[] reads.
 */
export function calculateOrderHash(params: ConditionalOrderParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address", name: "handler" },
            { type: "bytes32", name: "salt" },
            { type: "bytes", name: "staticInput" },
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
    )
  );
}
