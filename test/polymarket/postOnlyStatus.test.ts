import assert from "node:assert/strict";
import { test } from "node:test";
import { describePostOnlyStatus } from "../../src/client/orders/quoteErrors";
import { checkPostOnlyBuy } from "../../src/shared/orders/postOnly";

const rests = checkPostOnlyBuy(40, 0.55);

test("a disabled guard warns about immediate execution whatever the book says", () => {
  assert.match(describePostOnlyStatus(false, rests, "YES", 0.4), /Immediate execution/);
});

test("a crossing order reuses the crossing message", () => {
  const crosses = checkPostOnlyBuy(60, 0.5);
  assert.match(describePostOnlyStatus(true, crosses, "YES", 0.6), /would fire immediately/);
});

test("an unavailable book says so", () => {
  const unavailable = checkPostOnlyBuy(40, undefined);
  assert.match(describePostOnlyStatus(true, unavailable, "YES", 0.4), /unavailable/);
});

test("an empty ask side names the side", () => {
  assert.equal(
    describePostOnlyStatus(true, checkPostOnlyBuy(40, null), "NO", 0.4),
    "There are no NO sell orders right now. Your 40% trigger can wait on the book."
  );
});

test("a resting order quotes the best ask", () => {
  assert.equal(
    describePostOnlyStatus(true, rests, "YES", 0.4),
    "The best available YES price is 55%. Your 40% trigger can wait on the book."
  );
});
