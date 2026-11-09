import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaPath,
  buildPoints,
  clampOdds,
  indexAtX,
  linePath,
  nearestIndex,
  oddsToY,
  type ChartFrame,
} from "../../src/client/chart";

const frame: ChartFrame = { width: 104, height: 108, padX: 2, padY: 4 };

test("buildPoints spreads samples across the padded width and inverts Y", () => {
  assert.deepEqual(buildPoints([0, 0.5, 1], frame), [
    [2, 104],
    [52, 54],
    [102, 4],
  ]);
});

test("buildPoints clamps values outside the odds range", () => {
  assert.deepEqual(buildPoints([-1, 2], frame), [
    [2, 104],
    [102, 4],
  ]);
});

test("oddsToY leaves out-of-range values unclamped", () => {
  assert.equal(oddsToY(2, frame), -96);
  assert.equal(oddsToY(clampOdds(2), frame), 4);
});

test("linePath draws two-decimal segments and areaPath closes the shape", () => {
  const line = linePath([
    [2, 104],
    [102.125, 4],
  ]);
  assert.equal(line, "M2.00 104.00 L102.13 4.00");
  assert.equal(areaPath(line, frame), `${line} L 102 104 L 2 104 Z`);
});

test("nearestIndex finds the closest value", () => {
  assert.equal(nearestIndex([10, 20, 30], 29), 2);
  assert.equal(nearestIndex([10, 20, 30], 1), 0);
});

test("nearestIndex keeps the earliest entry on a tie", () => {
  assert.equal(nearestIndex([10, 20], 15), 0);
});

test("indexAtX rounds to the nearest sample and clamps to the data", () => {
  assert.equal(indexAtX(50, frame, 3), 1);
  assert.equal(indexAtX(-40, frame, 3), 0);
  assert.equal(indexAtX(900, frame, 3), 2);
});
