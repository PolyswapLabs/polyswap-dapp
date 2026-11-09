import assert from "node:assert/strict";
import { test } from "node:test";
import { createActionSignatureMessage } from "../../src/lib/actionSignature";

test("the signed action message keeps the format existing wallets sign", () => {
  assert.equal(
    createActionSignatureMessage("cancel_draft", "12", 1_700_000_000, 137),
    "PolySwap Action Request\nAction: cancel_draft\nOrder: 12\nTimestamp: 1700000000\nChain: 137"
  );
});
