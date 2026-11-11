import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/polyswap_migration_test";
process.env.ENVIRONMENT = "local";
const { parseCreateOrderRequest } = await import("../../src/backend/orders/createOrderRequest");
const { resolveDeadline } = await import("../../src/backend/orders/createOrder");

const ADDRESS = "0x1111111111111111111111111111111111111111";
const validBody = {
  sellToken: ADDRESS,
  buyToken: ADDRESS,
  sellAmount: "1000",
  selectedOutcome: "Yes",
  betPercentage: 40,
  marketId: "1",
  owner: ADDRESS,
};
const DAY_MS = 86_400_000;
const market = { end_date: null } as never;

function rejectionOf(body: unknown) {
  const parsed = parseCreateOrderRequest(body);
  return "rejection" in parsed ? parsed.rejection : null;
}

for (const body of [null, 42, "text"]) {
  test(`a ${JSON.stringify(body)} body is a client error`, () => {
    assert.equal(rejectionOf(body)?.status, 400);
  });
}

test("an unparseable startDate is a client error", () => {
  assert.equal(rejectionOf({ ...validBody, startDate: "soon" })?.error, "Invalid startDate");
});

test("an unparseable deadline is a client error", () => {
  assert.equal(rejectionOf({ ...validBody, deadline: "soon" })?.error, "Invalid deadline");
});

test("a valid request is accepted", () => {
  assert.equal(rejectionOf({ ...validBody, deadline: "2030-01-01T00:00:00Z" }), null);
});

test("an explicit deadline beyond the maximum horizon is rejected", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const tooFar = new Date(start.getTime() + 366 * DAY_MS).toISOString();
  assert.throws(() => resolveDeadline(tooFar, market, start), /365 days/);
});

test("an explicit deadline at the maximum horizon is kept", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const limit = new Date(start.getTime() + 365 * DAY_MS).toISOString();
  assert.equal(resolveDeadline(limit, market, start).deadline.toISOString(), limit);
});
