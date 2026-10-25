import { describe, expect, it } from "vitest";
import { addMarker } from "./edit";
import { clip, IMAGE, projectWith, VIDEO } from "./fixtures.test-util";
import { snapRange, snapTargets, snapTime } from "./snap";

const S = 1_000_000;

describe("snapTime", () => {
  it("pulls onto the nearest target within the threshold", () => {
    expect(snapTime(1_040_000, [0, S, 2 * S], 50_000)).toEqual({ time: S, target: S });
    expect(snapTime(1_960_000, [0, S, 2 * S], 50_000)).toEqual({ time: 2 * S, target: 2 * S });
  });

  it("leaves the time alone when nothing is close", () => {
    expect(snapTime(1_500_000, [0, S, 2 * S], 50_000)).toEqual({ time: 1_500_000, target: null });
  });
});

describe("snapRange", () => {
  it("snaps whichever edge is closer, keeping the length", () => {
    // The end (3.02s) is 20ms from 3s; the start (1.02s) is 20ms from 1s too, so the start wins ties.
    expect(snapRange(1_020_000, 2 * S, [S, 3 * S], 50_000)).toEqual({ time: S, target: S });
    // Only the end is near a target: the range moves so its end lands on 3s.
    expect(snapRange(1_200_000, 1_790_000, [3 * S], 50_000)).toEqual({ time: 1_210_000, target: 3 * S });
  });
});

describe("snapTargets", () => {
  it("collects zero, the playhead, markers and clip edges, skipping dragged clips", () => {
    const project = addMarker(
      projectWith({ clips: [clip("a", VIDEO, 0, 2 * S)] }, { clips: [clip("x", IMAGE, 3 * S, S)] }),
      5 * S,
    );
    expect(snapTargets(project, { playhead: 7 * S, exclude: new Set(["x"]) }).sort((a, b) => a - b)).toEqual([
      0,
      2 * S,
      5 * S,
      7 * S,
    ]);
  });
});
