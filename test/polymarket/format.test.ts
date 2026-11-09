import assert from "node:assert/strict";
import { test } from "node:test";
import { fmtPct } from "../../src/lib/format";

test("fmtPct renders a probability as a whole percent", () => {
  assert.equal(fmtPct(0.284), "28%");
  assert.equal(fmtPct(0.286), "29%");
});

test("fmtPct renders an unknown value as a dash", () => {
  assert.equal(fmtPct(Number.NaN), "—");
});
