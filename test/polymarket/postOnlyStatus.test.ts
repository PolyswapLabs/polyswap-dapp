import assert from "node:assert/strict";
import { test } from "node:test";
import { describePostOnlyStatus } from "../../src/client/orders/quoteErrors";
import { checkPostOnlyBuy } from "../../src/shared/orders/postOnly";

const rests = checkPostOnlyBuy(40, 0.55);

test("a disabled guard warns about immediate execution whatever the book says", () => {
  assert.match(describePostOnlyStatus(false, rests, "YES", 0.4), /Immediate execution/);
});

test("a crossing order names the live price and the highest threshold that waits", () => {
  const crosses = checkPostOnlyBuy(60, 0.5);
  assert.equal(
    describePostOnlyStatus(true, crosses, "YES", 0.6),
    "YES is already at 50%, so a 60% trigger would fire immediately. Pick 49% or lower."
  );
});

test("an unavailable book says so", () => {
  const unavailable = checkPostOnlyBuy(40, undefined);
  assert.match(describePostOnlyStatus(true, unavailable, "YES", 0.4), /unavailable/);
});

test("an empty ask side names the side", () => {
  assert.equal(
    describePostOnlyStatus(true, checkPostOnlyBuy(40, null), "NO", 0.4),
    "Nobody is selling NO right now. The swap fires if NO drops to 40%."
  );
});

test("a resting order quotes the best ask", () => {
  assert.equal(
    describePostOnlyStatus(true, rests, "YES", 0.4),
    "YES is at 55% right now. The swap fires if YES drops to 40%."
  );
});
