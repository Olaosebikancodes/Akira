import { describe, expect, it } from "vitest";
import { createClip } from "../project/create";
import { VIDEO } from "../project/fixtures.test-util";
import type { Clip } from "../project/model";
import { clipGainAt, gainEnvelope } from "./envelope";

const S = 1_000_000;

// 4 s clip at 1 s on the timeline, volume 0.8, 1 s fade in, 2 s fade out.
const clip: Clip = { ...createClip(VIDEO, S), sourceIn: 0, sourceOut: 4 * S, volume: 0.8, fadeIn: S, fadeOut: 2 * S };

describe("clipGainAt", () => {
  it("rises through the fade-in, holds, then falls through the fade-out", () => {
    expect(clipGainAt(clip, S)).toBe(0);
    expect(clipGainAt(clip, 1.5 * S)).toBeCloseTo(0.4);
    expect(clipGainAt(clip, 2 * S)).toBeCloseTo(0.8);
    expect(clipGainAt(clip, 3 * S)).toBeCloseTo(0.8);
    expect(clipGainAt(clip, 4 * S)).toBeCloseTo(0.4);
    expect(clipGainAt(clip, 5 * S)).toBe(0);
  });

  it("is just the volume without fades", () => {
    expect(clipGainAt({ ...clip, fadeIn: 0, fadeOut: 0 }, S)).toBe(0.8);
  });
});

describe("gainEnvelope", () => {
  it("lists the envelope's corners from the clip start", () => {
    expect(gainEnvelope(clip, 0)).toEqual([
      { time: S, gain: 0 },
      { time: 2 * S, gain: 0.8 },
      { time: 3 * S, gain: 0.8 },
      { time: 5 * S, gain: 0 },
    ]);
  });

  it("starts at the right level when playback begins mid-fade", () => {
    const points = gainEnvelope(clip, 4 * S);
    expect(points).toHaveLength(2);
    expect(points[0]!.time).toBe(4 * S);
    expect(points[0]!.gain).toBeCloseTo(0.4);
    expect(points[1]).toEqual({ time: 5 * S, gain: 0 });
  });

  it("is empty once the clip is over", () => {
    expect(gainEnvelope(clip, 6 * S)).toEqual([]);
  });
});
