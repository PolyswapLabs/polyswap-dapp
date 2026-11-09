/** Geometry of the probability tape: maps odds in [0, 1] onto SVG coordinates. */

export interface ChartFrame {
  width: number;
  height: number;
  padX: number;
  padY: number;
}

export type ChartPoint = readonly [x: number, y: number];

function innerHeight(frame: ChartFrame): number {
  return frame.height - frame.padY * 2;
}

/** Horizontal distance between two consecutive samples. */
export function stepX(frame: ChartFrame, count: number): number {
  return (frame.width - frame.padX * 2) / (count - 1);
}

export function clampOdds(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Y coordinate of `value`. Callers decide whether the value needs clamping first. */
export function oddsToY(value: number, frame: ChartFrame): number {
  return frame.padY + innerHeight(frame) - value * innerHeight(frame);
}

export function buildPoints(data: readonly number[], frame: ChartFrame): ChartPoint[] {
  const step = stepX(frame, data.length);
  return data.map((value, i) => [frame.padX + i * step, oddsToY(clampOdds(value), frame)] as const);
}

export function linePath(points: readonly ChartPoint[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");
}

/** Closes `line` along the bottom of the frame so it can be filled. */
export function areaPath(line: string, frame: ChartFrame): string {
  const { width, height, padX, padY } = frame;
  return `${line} L ${width - padX} ${height - padY} L ${padX} ${height - padY} Z`;
}

/** Index of the entry closest to `target`; the earliest wins a tie. Requires a non-empty list. */
export function nearestIndex(values: readonly number[], target: number): number {
  return values.reduce(
    (best, value, i) =>
      Math.abs(value - target) < Math.abs((values[best] as number) - target) ? i : best,
    0
  );
}

/** Index of the sample under viewBox coordinate `x`, clamped to the data range. */
export function indexAtX(x: number, frame: ChartFrame, count: number): number {
  const i = Math.round((x - frame.padX) / stepX(frame, count));
  return Math.max(0, Math.min(count - 1, i));
}
