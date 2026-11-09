import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BaseError,
  ContractFunctionExecutionError,
  encodeErrorResult,
  parseAbi,
  type Hex,
} from "viem";

// Override before importing the DB module, even when this test is run directly.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { classifyRevert, classifySingleOrderNotAuthed, extractRevertData } =
  await import("../../src/backend/listener/orderHealth/revertClassifier");

const ERRORS = parseAbi([
  "error OrderNotValid(string reason)",
  "error PollNever(string reason)",
  "error PollTryNextBlock(string reason)",
  "error PollTryAtBlock(uint256 blockNumber, string reason)",
  "error PollTryAtEpoch(uint256 timestamp, string reason)",
  "error SingleOrderNotAuthed()",
  "error ProofNotAuthed()",
  "error InterfaceNotSupported()",
  "error SwapGuardRestricted()",
  "error InvalidFallbackHandler()",
]);

type RevertName = (typeof ERRORS)[number]["name"];

function revert(errorName: RevertName, ...args: readonly unknown[]): Hex {
  return encodeErrorResult({
    abi: ERRORS,
    errorName,
    args,
  } as Parameters<typeof encodeErrorResult>[0]);
}

function outcome(classification: ReturnType<typeof classifyRevert>) {
  const { errorCode, reason, retryAt, nextStatus } = classification;
  return { errorCode, reason, retryAt, nextStatus };
}

test("OrderNotValid past its end date expires the order", () => {
  assert.deepEqual(outcome(classifyRevert(revert("OrderNotValid", "invalid end date"))), {
    errorCode: "OrderNotValid",
    reason: "invalid end date",
    retryAt: null,
    nextStatus: "expired",
  });
});

test("any other OrderNotValid is terminal", () => {
  assert.deepEqual(outcome(classifyRevert(revert("OrderNotValid", "bad sell token"))), {
    errorCode: "OrderNotValid",
    reason: "bad sell token",
    retryAt: null,
    nextStatus: "errored",
  });
});

test("PollNever is terminal", () => {
  assert.deepEqual(outcome(classifyRevert(revert("PollNever", "resolved"))), {
    errorCode: "PollNever",
    reason: "resolved",
    retryAt: null,
    nextStatus: "errored",
  });
});

test("wait signals keep the order live and carry the retry point", () => {
  assert.deepEqual(outcome(classifyRevert(revert("PollTryNextBlock", "gate closed"))), {
    errorCode: "PollTryNextBlock",
    reason: "gate closed",
    retryAt: null,
    nextStatus: null,
  });
  assert.deepEqual(outcome(classifyRevert(revert("PollTryAtBlock", 123n, "at block"))), {
    errorCode: "PollTryAtBlock",
    reason: "at block",
    retryAt: null,
    nextStatus: null,
  });
  assert.deepEqual(outcome(classifyRevert(revert("PollTryAtEpoch", 456n, "at epoch"))), {
    errorCode: "PollTryAtEpoch",
    reason: "at epoch",
    retryAt: 456,
    nextStatus: null,
  });
});

test("a retry point of zero is kept, not treated as missing", () => {
  assert.equal(classifyRevert(revert("PollTryAtEpoch", 0n, "now")).retryAt, 0);
});

test("wait signals log quietly while terminal poll errors warn", () => {
  assert.equal(classifyRevert(revert("PollTryNextBlock", "gate")).logLevel, "debug");
  assert.equal(classifyRevert(revert("PollNever", "resolved")).logLevel, "warn");
  assert.equal(classifyRevert(revert("OrderNotValid", "bad")).logLevel, "warn");
});

test("ComposableCoW auth failures that can never succeed are terminal", () => {
  assert.deepEqual(outcome(classifyRevert(revert("ProofNotAuthed"))), {
    errorCode: "ProofNotAuthed",
    reason: "Merkle proof not authorised on-chain",
    retryAt: null,
    nextStatus: "errored",
  });
  assert.deepEqual(outcome(classifyRevert(revert("InterfaceNotSupported"))), {
    errorCode: "InterfaceNotSupported",
    reason: "Handler does not implement IConditionalOrderGenerator",
    retryAt: null,
    nextStatus: "errored",
  });
});

test("ComposableCoW errors the owner can fix keep the order live", () => {
  assert.deepEqual(outcome(classifyRevert(revert("SwapGuardRestricted"))), {
    errorCode: "SwapGuardRestricted",
    reason: "Blocked by the Safe's swap guard",
    retryAt: null,
    nextStatus: null,
  });
  assert.deepEqual(outcome(classifyRevert(revert("InvalidFallbackHandler"))), {
    errorCode: "InvalidFallbackHandler",
    reason: "Safe is missing CoW's ExtensibleFallbackHandler",
    retryAt: null,
    nextStatus: null,
  });
});

test("an unknown selector is recorded without changing the order", () => {
  assert.deepEqual(outcome(classifyRevert("0xdeadbeef00")), {
    errorCode: "UnknownRevert",
    reason: "Unknown revert",
    retryAt: null,
    nextStatus: null,
  });
});

test("SingleOrderNotAuthed stays unresolved until the on-chain auth state is known", () => {
  assert.deepEqual(
    outcome(classifyRevert(revert("SingleOrderNotAuthed"))),
    outcome(classifySingleOrderNotAuthed("unknown"))
  );
  assert.deepEqual(outcome(classifySingleOrderNotAuthed("unknown")), {
    errorCode: "SingleOrderNotAuthed",
    reason: "Conditional order not authorised on-chain (params don't match, or order removed)",
    retryAt: null,
    nextStatus: null,
  });
});

test("a removed order is canceled", () => {
  assert.deepEqual(outcome(classifySingleOrderNotAuthed("canceled")), {
    errorCode: "OrderRemoved",
    reason: "Conditional order removed on-chain by the owner",
    retryAt: null,
    nextStatus: "canceled",
  });
});

test("encoding drift is recorded but leaves the order live", () => {
  assert.deepEqual(outcome(classifySingleOrderNotAuthed("reconstruction-mismatch")), {
    errorCode: "ParamsMismatch",
    reason: "Reconstructed params don't match the authorized order_hash (encoding drift)",
    retryAt: null,
    nextStatus: null,
  });
});

function contractError(cause: object): ContractFunctionExecutionError {
  return new ContractFunctionExecutionError(Object.assign(new BaseError("boom"), cause), {
    abi: [],
    functionName: "getTradeableOrderWithSignature",
  });
}

test("revert data prefers the raw bytes over a decoded payload", () => {
  assert.equal(extractRevertData(contractError({ raw: "0xaa", data: "0xbb" })), "0xaa");
  assert.equal(extractRevertData(contractError({ data: "0xbb" })), "0xbb");
});

test("errors carrying no revert bytes yield nothing", () => {
  assert.equal(extractRevertData(contractError({ data: { errorName: "x" } })), undefined);
  assert.equal(extractRevertData(contractError({})), undefined);
  assert.equal(extractRevertData(new Error("network")), undefined);
});
