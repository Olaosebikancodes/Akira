import { describe, expect, it } from "vitest";
import { applySpeedPreset, setClipSpeed, setSpeedCurve, splitClip, trimClip } from "./edit";
import { clip, IMAGE, projectWith, VIDEO } from "./fixtures.test-util";
import type { Project, SpeedPoint } from "./model";
import { findClip } from "./query";
import { curveSpeed, MAX_CURVE_SPEED, SPEED_PRESETS } from "./speed-curve";
import { clipDuration, clipEnd, rateAt, toSourceTime, toTimelineTime } from "./timing";

const S = 1_000_000;

function points(...pairs: [number, number][]): SpeedPoint[] {
  return pairs.map(([time, speed]) => ({ time, speed }));
}

/** A 4 s video clip followed by a second clip, so retiming shows on the main track. */
function curved(curve: SpeedPoint[]): Project {
  return setSpeedCurve(projectWith({ clips: [clip("a", VIDEO, 0, 4 * S), clip("b", VIDEO, 4 * S, S)] }), "a", curve);
}

describe("curveSpeed", () => {
  const ramp = points([S, 0.5], [3 * S, 2]);

  it("holds the first and last speeds outside the points", () => {
    expect(curveSpeed(ramp, 0)).toBe(0.5);
    expect(curveSpeed(ramp, 5 * S)).toBe(2);
  });

  it("eases on a logarithmic scale, so half-way between 0.5× and 2× is 1×", () => {
    expect(curveSpeed(ramp, 2 * S)).toBeCloseTo(1, 10);
    expect(curveSpeed(ramp, 1.2 * S)).toBeLessThan(0.6);
  });
});

describe("timing along a curve", () => {
  it("matches constant speed when the curve is flat", () => {
    const a = findClip(curved(points([0, 2], [4 * S, 2])), "a")!;
    expect(clipDuration(a)).toBe(2 * S);
    expect(toSourceTime(a, S)).toBe(2 * S);
    expect(toTimelineTime(a, 3 * S)).toBe(1.5 * S);
    expect(rateAt(a, S)).toBe(2);
  });

  it("lasts longer through slow parts and shorter through fast ones", () => {
    const slow = findClip(curved(points([0, 1], [2 * S, 0.5], [4 * S, 1])), "a")!;
    expect(clipDuration(slow)).toBeGreaterThan(4 * S);
    const fast = findClip(curved(points([0, 1], [2 * S, 3], [4 * S, 1])), "a")!;
    expect(clipDuration(fast)).toBeLessThan(4 * S);
  });

  it("maps there and back to the same frame", () => {
    const a = findClip(curved(points([0, 0.4], [S, 3], [3 * S, 0.2], [4 * S, 1])), "a")!;
    for (let source = 0; source < 4 * S; source += 123_457) {
      expect(Math.abs(toSourceTime(a, toTimelineTime(a, source)) - source)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the next clip right after on the main track", () => {
    const project = curved(points([0, 1], [2 * S, 0.5], [4 * S, 1]));
    expect(findClip(project, "b")!.start).toBe(clipEnd(findClip(project, "a")!));
  });

  it("stays exactly the same through a split", () => {
    const project = curved(points([0, 1], [2 * S, 0.25], [4 * S, 2]));
    const whole = findClip(project, "a")!;
    const cut = Math.round(clipDuration(whole) / 3);
    const { project: split, rightId } = splitClip(project, "a", cut);
    const left = findClip(split, "a")!;
    const right = findClip(split, rightId!)!;
    expect(Math.abs(clipDuration(left) + clipDuration(right) - clipDuration(whole))).toBeLessThanOrEqual(1);
    for (const time of [cut + 100_000, cut + S, clipEnd(whole) - 50_000]) {
      expect(Math.abs(toSourceTime(right, time) - toSourceTime(whole, time))).toBeLessThanOrEqual(1);
    }
  });

  it("keeps its timing when the end is trimmed", () => {
    const project = curved(points([0, 1], [4 * S, 0.5]));
    const whole = findClip(project, "a")!;
    const trimmed = findClip(trimClip(project, "a", "end", 2 * S), "a")!;
    // Within a microsecond: the trim point goes through the curve and back.
    expect(Math.abs(clipEnd(trimmed) - 2 * S)).toBeLessThanOrEqual(1);
    expect(Math.abs(toSourceTime(trimmed, 1.5 * S) - toSourceTime(whole, 1.5 * S))).toBeLessThanOrEqual(1);
  });
});

describe("speed curve edits", () => {
  it("sorts points and keeps speeds in range", () => {
    const a = findClip(curved(points([3 * S, 50], [0, 1])), "a")!;
    expect(a.speedCurve).toEqual(points([0, 1], [3 * S, MAX_CURVE_SPEED]));
  });

  it("needs at least two points", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S)] });
    expect(setSpeedCurve(project, "a", points([0, 2]))).toBe(project);
  });

  it("goes back to constant speed", () => {
    const a = findClip(setClipSpeed(curved(points([0, 1], [4 * S, 3])), "a", 2), "a")!;
    expect(a.speedCurve).toBeUndefined();
    expect(clipDuration(a)).toBe(2 * S);
  });

  it("spreads a preset across the clip's footage", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S, 2 * S)] });
    const a = findClip(applySpeedPreset(project, "a", "hero"), "a")!;
    const hero = SPEED_PRESETS.find((p) => p.id === "hero")!;
    expect(a.speedCurve).toHaveLength(hero.points.length);
    expect(a.speedCurve![0]!.time).toBe(2 * S);
    expect(a.speedCurve!.at(-1)!.time).toBe(6 * S);
  });

  it("leaves stills alone", () => {
    const project = projectWith({ clips: [clip("s", IMAGE, 0, 4 * S)] });
    expect(applySpeedPreset(project, "s", "hero")).toBe(project);
  });
});
