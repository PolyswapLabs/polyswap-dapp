import assert from "node:assert/strict";
import { test } from "node:test";
import { groupTokens, tokenKey, type TokenGroup } from "../../src/lib/tokenGroups";
import type { TokenViewModel } from "../../src/types/design";

const token = (symbol: string, address: string, name = `${symbol} token`) =>
  ({ symbol, name, address, decimals: 18 }) as TokenViewModel;

const usdc = token("USDC", "0xAAA1");
const dai = token("DAI", "0xAAA2");
const aave = token("AAVE", "0xAAA3");
const zrx = token("ZRX", "0xAAA4");
const options = [zrx, aave, dai, usdc];

const noBalances = new Map<string, bigint>();
const symbols = (groups: TokenGroup[]) =>
  Object.fromEntries(groups.map((g) => [g.title, g.tokens.map((t) => t.symbol)]));

test("tokenKey lowercases the address", () => {
  assert.equal(tokenKey(usdc), "0xaaa1");
});

test("without balances, tokens split into popular and the rest", () => {
  const groups = groupTokens({ options, query: "", balances: noBalances, showBalances: false });
  assert.deepEqual(symbols(groups), { Popular: ["USDC", "DAI"], "All tokens": ["AAVE", "ZRX"] });
});

test("owned tokens sort by balance, then symbol, and leave the other sections", () => {
  const balances = new Map([
    ["0xaaa2", 5n],
    ["0xaaa4", 5n],
    ["0xaaa3", 9n],
  ]);
  const groups = groupTokens({ options, query: "", balances, showBalances: true });
  assert.deepEqual(symbols(groups), {
    "In your wallet": ["AAVE", "DAI", "ZRX"],
    Popular: ["USDC"],
  });
});

test("balances are ignored when showBalances is off", () => {
  const balances = new Map([["0xaaa3", 9n]]);
  const groups = groupTokens({ options, query: "", balances, showBalances: false });
  assert.equal(
    groups.find((g) => g.id === "owned"),
    undefined
  );
});

test("the query matches symbol, name or address, ignoring case and padding", () => {
  const search = (query: string) =>
    groupTokens({ options, query, balances: noBalances, showBalances: false }).flatMap((g) =>
      g.tokens.map((t) => t.symbol)
    );
  assert.deepEqual(search(" aave "), ["AAVE"]);
  assert.deepEqual(search("zrx tok"), ["ZRX"]);
  assert.deepEqual(search("0XAAA2"), ["DAI"]);
  assert.deepEqual(search("nope"), []);
});

test("a whitespace query still matches everything but titles the last section Results", () => {
  const groups = groupTokens({ options, query: "  ", balances: noBalances, showBalances: false });
  assert.deepEqual(
    groups.map((g) => g.title),
    ["Popular", "Results"]
  );
});
