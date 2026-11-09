import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderViewModel } from "../../src/hooks/orders/orderMapper";
import {
  computePortfolioMetrics,
  describeTriggerDistance,
} from "../../src/client/orders/orderMetrics";
import { DAY_MS } from "../../src/utils/time";

const NOW = Date.UTC(2026, 5, 15);
const live = { phase: "live", gateOpenedAt: null, threshold: 0.4 } as const;

test("describeTriggerDistance prefers a fill over everything else", () => {
  assert.equal(
    describeTriggerDistance({ ...live, phase: "filled", gateOpenedAt: new Date(NOW) }, 0.9),
    "Filled"
  );
});

test("describeTriggerDistance reports an opened gate before the live odds", () => {
  assert.equal(
    describeTriggerDistance({ ...live, gateOpenedAt: new Date(NOW) }, 0.9),
    "Trigger fired"
  );
});

test("describeTriggerDistance treats odds at or below the line as met", () => {
  assert.equal(describeTriggerDistance(live, 0.4), "Threshold met");
  assert.equal(describeTriggerDistance(live, 0.1), "Threshold met");
});

test("describeTriggerDistance shows the remaining points otherwise", () => {
  assert.equal(describeTriggerDistance(live, 0.55), "15.0 pts until trigger");
});

function order(overrides: Partial<OrderViewModel>): OrderViewModel {
  return {
    status: "done",
    nickname: "Swap",
    startTime: new Date(NOW - 10 * DAY_MS),
    filledAt: null,
    ...overrides,
  } as OrderViewModel;
}

test("computePortfolioMetrics describes an empty portfolio", () => {
  const [total, avg, last, hit] = computePortfolioMetrics([], NOW);
  assert.equal(total?.caption, "Nothing fired yet");
  assert.equal(avg?.caption, "No fires yet");
  assert.deepEqual(last, { kind: "text", label: "Last fill", value: "—", caption: "No fires yet" });
  assert.equal(hit?.caption, "No closed swaps yet");
  assert.equal(hit?.badge, undefined);
});

test("computePortfolioMetrics averages fills and finds the latest one", () => {
  const metrics = computePortfolioMetrics(
    [
      order({ nickname: "Old", filledAt: new Date(NOW - 8 * DAY_MS) }),
      order({ nickname: "New", filledAt: new Date(NOW - 2 * DAY_MS) }),
      order({ status: "cancelled" }),
    ],
    NOW
  );
  const [total, avg, last, hit] = metrics;
  assert.equal(total?.caption, "2 in the last 30d");
  assert.equal(avg?.kind === "number" && avg.raw, 5);
  assert.equal(avg?.caption, "Across 2 fired swaps");
  assert.equal(last?.kind === "text" && last.value, "2d ago");
  assert.equal(last?.caption, "New");
  assert.equal(hit?.kind === "number" && hit.format(66.6), "67%");
  assert.equal(hit?.caption, "2/3 fired");
  assert.equal(hit?.badge, undefined);
});

test("computePortfolioMetrics awards the stamp only after two perfect closes", () => {
  const filled = order({ filledAt: new Date(NOW) });
  assert.equal(computePortfolioMetrics([filled], NOW)[3]?.badge, undefined);
  assert.equal(computePortfolioMetrics([filled, filled], NOW)[3]?.badge, "Perfect record");
});

test("computePortfolioMetrics only counts fills from the last 30 days", () => {
  const stale = order({ filledAt: new Date(NOW - 31 * DAY_MS) });
  assert.equal(computePortfolioMetrics([stale], NOW)[0]?.caption, "0 in the last 30d");
});
