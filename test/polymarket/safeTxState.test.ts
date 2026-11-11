import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Hash } from "viem";
import {
  callsStatusToSafeTxStatus,
  multisigTxToSafeTxStatus,
  readPendingSafeTx,
  toFailurePhase,
} from "../../src/hooks/safe/safeTxState";

const HASH = `0x${"a".repeat(64)}` as Hash;
const KEY = "pending";
const receipts = [{ transactionHash: HASH }];

const store = new Map<string, string>();
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

beforeEach(() => store.clear());

const pending = (overrides: object = {}) =>
  JSON.stringify({ safeTxHash: HASH, kind: "safetx", ts: Date.now(), ...overrides });

test("a fresh pending tx of the expected kind is recovered", () => {
  store.set(KEY, pending());
  assert.equal(readPendingSafeTx(KEY, "safetx")?.safeTxHash, HASH);
  assert.equal(store.has(KEY), true);
});

test("nothing stored recovers nothing", () => {
  assert.equal(readPendingSafeTx(KEY, "safetx"), null);
});

for (const [name, raw] of [
  ["malformed JSON", "{"],
  ["a JSON null", "null"],
  ["an invalid hash", pending({ safeTxHash: "0x12" })],
  ["a missing timestamp", pending({ ts: "soon" })],
  ["an unknown kind", pending({ kind: "other" })],
  ["an entry older than an hour", pending({ ts: Date.now() - 60 * 60 * 1000 - 1000 })],
  ["a tx sent through the other path", pending({ kind: "5792" })],
] as const) {
  test(`${name} is discarded`, () => {
    store.set(KEY, raw);
    assert.equal(readPendingSafeTx(KEY, "safetx"), null);
    assert.equal(store.has(KEY), false);
  });
}

test("wallet rejections are told apart from failures", () => {
  const rejected = { phase: "rejected", message: "You rejected the request in Safe" };
  assert.deepEqual(toFailurePhase({ code: 4001, message: "no" }), rejected);
  assert.deepEqual(toFailurePhase({ code: "ACTION_REJECTED" }), rejected);
  assert.deepEqual(toFailurePhase(new Error("boom")), { phase: "error", message: "boom" });
  assert.deepEqual(toFailurePhase({}), { phase: "error", message: "Unknown error" });
});

test("a pending batch awaits execution", () => {
  assert.deepEqual(callsStatusToSafeTxStatus({ status: "pending" }), {
    kind: "awaitingExecution",
  });
});

test("a successful batch needs a receipt before it counts as executed", () => {
  assert.deepEqual(callsStatusToSafeTxStatus({ status: "success", receipts }), {
    kind: "executed",
    onChainHash: HASH,
  });
  assert.equal(callsStatusToSafeTxStatus({ status: "success", receipts: [] }), null);
});

test("a failed batch with a receipt reverted onchain", () => {
  assert.deepEqual(callsStatusToSafeTxStatus({ status: "failure", statusCode: 500, receipts }), {
    kind: "reverted",
    onChainHash: HASH,
  });
});

function errorMessage(statusCode?: number): string | undefined {
  const status = callsStatusToSafeTxStatus({ status: "failure", statusCode });
  return status?.kind === "error" ? status.error.message : undefined;
}

test("a failed batch without a receipt is an error naming its cause", () => {
  assert.equal(errorMessage(400), "The wallet cancelled the request.");
  assert.equal(errorMessage(600), "Transaction failed (status 600).");
  assert.equal(errorMessage(), "Transaction failed (status unknown).");
});

test("an unknown batch status reports nothing", () => {
  assert.equal(callsStatusToSafeTxStatus({ status: undefined }), null);
});

const multisigTx = {
  isExecuted: false,
  isSuccessful: null,
  transactionHash: null,
  confirmations: [],
  confirmationsRequired: 2,
};

test("an unexecuted multisig tx reports its signature progress", () => {
  const confirmation = {} as never;
  assert.deepEqual(multisigTxToSafeTxStatus({ ...multisigTx, confirmations: [confirmation] }), {
    kind: "awaitingSignatures",
    have: 1,
    need: 2,
  });
  assert.deepEqual(
    multisigTxToSafeTxStatus({ ...multisigTx, confirmations: [confirmation, confirmation] }),
    { kind: "awaitingExecution" }
  );
});

test("an executed multisig tx reports its outcome once it is indexed", () => {
  const executed = { ...multisigTx, isExecuted: true, transactionHash: HASH };
  assert.deepEqual(multisigTxToSafeTxStatus({ ...executed, isSuccessful: true }), {
    kind: "executed",
    onChainHash: HASH,
  });
  assert.deepEqual(multisigTxToSafeTxStatus({ ...executed, isSuccessful: false }), {
    kind: "reverted",
    onChainHash: HASH,
  });
  assert.equal(multisigTxToSafeTxStatus(executed), null);
});
