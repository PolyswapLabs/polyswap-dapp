import assert from "node:assert/strict";
import { test } from "node:test";
import { readPositiveInt, requireAddress, toPrivateKeyHex } from "../../src/backend/utils/env";

const VAR = "POLYSWAP_ENV_TEST";

function withEnv(value: string | undefined, run: () => void) {
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  try {
    run();
  } finally {
    delete process.env[VAR];
  }
}

test("requireAddress returns a configured value", () => {
  withEnv("0xabc", () => assert.equal(requireAddress(VAR), "0xabc"));
});

test("requireAddress names the missing variable", () => {
  withEnv(undefined, () => assert.throws(() => requireAddress(VAR), new RegExp(VAR)));
});

test("readPositiveInt reads a positive integer", () => {
  withEnv("15", () => assert.equal(readPositiveInt(VAR, 3), 15));
});

for (const invalid of [undefined, "", "0", "-4", "abc"]) {
  test(`readPositiveInt falls back for ${JSON.stringify(invalid)}`, () => {
    withEnv(invalid, () => assert.equal(readPositiveInt(VAR, 3), 3));
  });
}

test("toPrivateKeyHex adds a missing 0x prefix", () => {
  assert.equal(toPrivateKeyHex("abcd"), "0xabcd");
});

test("toPrivateKeyHex keeps an existing 0x prefix", () => {
  assert.equal(toPrivateKeyHex("0xabcd"), "0xabcd");
});
