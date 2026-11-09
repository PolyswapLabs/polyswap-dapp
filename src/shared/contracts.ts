import { getAddress, type Address } from "viem";

/** Canonical Polygon ComposableCoW deployment, unless overridden by the environment. */
export const COMPOSABLE_COW: Address = getAddress(
  process.env.COMPOSABLE_COW ??
    process.env.NEXT_PUBLIC_COMPOSABLE_COW ??
    "0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74"
);
