import type { Micros } from "../time";
import type { SpeedPoint } from "./model";

/** Curves go further than constant speed: a ramp needs a real slow-down and a real burst. */
export const MIN_CURVE_SPEED = 0.1;
export const MAX_CURVE_SPEED = 10;

/** Samples per clip when building the timeline-to-source table; plenty for frame accuracy. */
const TABLE_STEPS = 2048;

/**
 * Speed at a source time. Between points it eases in and out on a
 * logarithmic scale, so 0.5× to 2× feels as even as 2× to 0.5×, and it can
 * never reach zero. Before the first point and after the last it holds.
 */
export function curveSpeed(points: readonly SpeedPoint[], time: Micros): number {
  const first = points[0]!;
  if (time <= first.time) return first.speed;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (time < to.time) {
      const t = (time - from.time) / (to.time - from.time);
      const eased = t * t * (3 - 2 * t);
      return 2 ** (Math.log2(from.speed) + (Math.log2(to.speed) - Math.log2(from.speed)) * eased);
    }
  }
  return points[points.length - 1]!.speed;
}

/**
 * Timeline time for each step of a clip's source range: the running total
 * of 1/speed. Built once per curve and range, then reused by every lookup.
 */
interface CurveTable {
  /** Source micros between samples. */
  step: number;
  /** Timeline offset at each sample, from 0 at `sourceIn`. */
  offsets: Float64Array;
  /** Speed at the start and end of the range, for times just outside it. */
  startSpeed: number;
  endSpeed: number;
}

const tables = new WeakMap<readonly SpeedPoint[], Map<string, CurveTable>>();

function tableFor(points: readonly SpeedPoint[], sourceIn: Micros, sourceOut: Micros): CurveTable {
  let byRange = tables.get(points);
  if (!byRange) {
    byRange = new Map();
    tables.set(points, byRange);
  }
  const key = `${sourceIn}:${sourceOut}`;
  let table = byRange.get(key);
  if (!table) {
    const step = Math.max(1, sourceOut - sourceIn) / TABLE_STEPS;
    const offsets = new Float64Array(TABLE_STEPS + 1);
    let previous = 1 / curveSpeed(points, sourceIn);
    for (let i = 1; i <= TABLE_STEPS; i++) {
      // Trapezoids over a fine grid: the curve is smooth, so this is exact to well under a frame.
      const current = 1 / curveSpeed(points, sourceIn + i * step);
      offsets[i] = offsets[i - 1]! + ((previous + current) / 2) * step;
      previous = current;
    }
    table = { step, offsets, startSpeed: curveSpeed(points, sourceIn), endSpeed: curveSpeed(points, sourceOut) };
    byRange.set(key, table);
  }
  return table;
}

/** How long a source range lasts on the timeline when played along the curve. */
export function curveLength(points: readonly SpeedPoint[], sourceIn: Micros, sourceOut: Micros): Micros {
  return tableFor(points, sourceIn, sourceOut).offsets[TABLE_STEPS]!;
}

/** Timeline offset from `sourceIn` at which source offset `into` plays. */
export function curveTimelineOffset(points: readonly SpeedPoint[], sourceIn: Micros, sourceOut: Micros, into: Micros): Micros {
  const table = tableFor(points, sourceIn, sourceOut);
  const total = table.offsets[TABLE_STEPS]!;
  if (into <= 0) return into / table.startSpeed;
  const length = sourceOut - sourceIn;
  if (into >= length) return total + (into - length) / table.endSpeed;
  const position = into / table.step;
  const i = Math.floor(position);
  const a = table.offsets[i]!;
  const b = table.offsets[Math.min(i + 1, TABLE_STEPS)]!;
  return a + (b - a) * (position - i);
}

/** Source offset from `sourceIn` playing at timeline offset `elapsed`: the inverse of curveTimelineOffset. */
export function curveSourceOffset(points: readonly SpeedPoint[], sourceIn: Micros, sourceOut: Micros, elapsed: Micros): Micros {
  const table = tableFor(points, sourceIn, sourceOut);
  const total = table.offsets[TABLE_STEPS]!;
  if (elapsed <= 0) return elapsed * table.startSpeed;
  if (elapsed >= total) return sourceOut - sourceIn + (elapsed - total) * table.endSpeed;
  // The offsets only ever increase, so a binary search finds the step.
  let low = 0;
  let high = TABLE_STEPS;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (table.offsets[middle]! <= elapsed) low = middle;
    else high = middle;
  }
  const a = table.offsets[low]!;
  const b = table.offsets[high]!;
  return (low + (b > a ? (elapsed - a) / (b - a) : 0)) * table.step;
}

/** A preset's shape: speeds at fractions of the clip, mapped onto its footage when applied. */
export interface SpeedPreset {
  id: string;
  label: string;
  points: readonly { at: number; speed: number }[];
}

/** Ramps like the ones people reach for most in short-form video. */
export const SPEED_PRESETS: readonly SpeedPreset[] = [
  { id: "montage", label: "Montage", points: [{ at: 0, speed: 1 }, { at: 0.3, speed: 3 }, { at: 0.5, speed: 0.5 }, { at: 0.7, speed: 3 }, { at: 1, speed: 1 }] },
  { id: "hero", label: "Hero", points: [{ at: 0, speed: 1 }, { at: 0.35, speed: 1 }, { at: 0.5, speed: 0.2 }, { at: 0.65, speed: 1 }, { at: 1, speed: 1 }] },
  { id: "bullet", label: "Bullet", points: [{ at: 0, speed: 3 }, { at: 0.4, speed: 3 }, { at: 0.5, speed: 0.15 }, { at: 0.6, speed: 3 }, { at: 1, speed: 3 }] },
  { id: "jump-cut", label: "Jump cut", points: [{ at: 0, speed: 1 }, { at: 0.42, speed: 1 }, { at: 0.5, speed: 6 }, { at: 0.58, speed: 1 }, { at: 1, speed: 1 }] },
  { id: "flash-in", label: "Flash in", points: [{ at: 0, speed: 6 }, { at: 0.35, speed: 1 }, { at: 1, speed: 1 }] },
  { id: "flash-out", label: "Flash out", points: [{ at: 0, speed: 1 }, { at: 0.65, speed: 1 }, { at: 1, speed: 6 }] },
  { id: "ramp-up", label: "Ramp up", points: [{ at: 0, speed: 0.5 }, { at: 1, speed: 3 }] },
  { id: "ramp-down", label: "Ramp down", points: [{ at: 0, speed: 3 }, { at: 1, speed: 0.5 }] },
];

/** Places a preset's points across a clip's source range. */
export function presetPoints(preset: SpeedPreset, sourceIn: Micros, sourceOut: Micros): SpeedPoint[] {
  return preset.points.map(({ at, speed }) => ({ time: Math.round(sourceIn + at * (sourceOut - sourceIn)), speed }));
}
