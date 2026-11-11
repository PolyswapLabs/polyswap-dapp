import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPercent, formatRelative, formatAddress } from "../../src/utils/format";

test("formatPercent renders a probability as a whole percent", () => {
  assert.equal(formatPercent(0.284), "28%");
  assert.equal(formatPercent(0.286), "29%");
});

test("formatPercent renders an unknown value as a dash", () => {
  assert.equal(formatPercent(Number.NaN), "—");
});

const NOW = Date.UTC(2026, 0, 1);
const ago = (ms: number) => new Date(NOW - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("formatRelative walks from seconds up to years", () => {
  assert.equal(formatRelative(ago(30_000), NOW), "Just now");
  assert.equal(formatRelative(ago(5 * MINUTE), NOW), "5m ago");
  assert.equal(formatRelative(ago(3 * HOUR), NOW), "3h ago");
  assert.equal(formatRelative(ago(2 * DAY), NOW), "2d ago");
  assert.equal(formatRelative(ago(60 * DAY), NOW), "2mo ago");
  assert.equal(formatRelative(ago(800 * DAY), NOW), "2y ago");
});

test("formatAddress keeps the prefix and last four characters", () => {
  assert.equal(formatAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
});
