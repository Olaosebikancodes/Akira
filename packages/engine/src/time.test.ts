import { describe, expect, it } from "vitest";
import {
  FPS_23_976,
  FPS_24,
  FPS_25,
  FPS_29_97,
  FPS_30,
  FPS_59_94,
  FPS_60,
  type FrameRate,
  formatTimecode,
  frameRateFromNumber,
  frameToMicros,
  microsToFrame,
  secondsToMicros,
  snapToFrame,
} from "./time";

const RATES: [string, FrameRate][] = [
  ["23.976", FPS_23_976],
  ["24", FPS_24],
  ["25", FPS_25],
  ["29.97", FPS_29_97],
  ["30", FPS_30],
  ["59.94", FPS_59_94],
  ["60", FPS_60],
  ["120", { num: 120, den: 1 }],
  // 1e6 / 128 = 7812.5: frames land exactly on half a microsecond.
  ["128", { num: 128, den: 1 }],
];

describe("frameToMicros", () => {
  it("is exact for whole-number rates", () => {
    expect(frameToMicros(0, FPS_30)).toBe(0);
    expect(frameToMicros(1, FPS_25)).toBe(40_000);
    expect(frameToMicros(30, FPS_30)).toBe(1_000_000);
  });

  it("rounds NTSC frames to the nearest microsecond", () => {
    expect(frameToMicros(1, FPS_29_97)).toBe(33_367);
    expect(frameToMicros(2, FPS_29_97)).toBe(66_733);
    expect(frameToMicros(30_000, FPS_29_97)).toBe(1_001_000_000);
  });

  it("does not drift over a ten-hour timeline", () => {
    const frames = 10 * 60 * 60 * 60;
    expect(frameToMicros(frames, FPS_59_94)).toBe(
      Math.round((frames * 1_000_000 * 1001) / 60000),
    );
  });
});

describe("microsToFrame", () => {
  // These check 20,000 frames each, so they collect mismatches and assert
  // once: an expect() per frame made them slow enough to time out under load.
  it.each(RATES)("round-trips every frame at %s fps", (_, rate) => {
    const wrong: number[] = [];
    for (let frame = 0; frame < 20_000; frame++) {
      if (microsToFrame(frameToMicros(frame, rate), rate) !== frame) wrong.push(frame);
    }
    expect(wrong).toEqual([]);
  });

  it.each(RATES)(
    "keeps the previous frame until the next one starts at %s fps",
    (_, rate) => {
      const wrong: number[] = [];
      for (let frame = 1; frame < 20_000; frame++) {
        if (microsToFrame(frameToMicros(frame, rate) - 1, rate) !== frame - 1) wrong.push(frame);
      }
      expect(wrong).toEqual([]);
    },
  );

  it("handles times far beyond a realistic project", () => {
    const tenDays = secondsToMicros(10 * 24 * 60 * 60);
    expect(microsToFrame(tenDays, FPS_60)).toBe(10 * 24 * 60 * 60 * 60);
  });
});

describe("snapToFrame", () => {
  it("moves a time back to the start of its frame", () => {
    expect(snapToFrame(50_000, FPS_30)).toBe(33_333);
    expect(snapToFrame(66_733, FPS_29_97)).toBe(66_733);
    expect(snapToFrame(66_732, FPS_29_97)).toBe(33_367);
  });
});

describe("frameRateFromNumber", () => {
  it("recovers exact NTSC rates from measured averages", () => {
    expect(frameRateFromNumber(29.97002997)).toEqual(FPS_29_97);
    expect(frameRateFromNumber(23.976)).toEqual(FPS_23_976);
    expect(frameRateFromNumber(59.94)).toEqual(FPS_59_94);
  });

  it("keeps whole-number rates whole", () => {
    expect(frameRateFromNumber(30)).toEqual(FPS_30);
    expect(frameRateFromNumber(120.0004)).toEqual({ num: 120, den: 1 });
  });

  it("falls back to a /1000 fraction for unusual rates", () => {
    expect(frameRateFromNumber(14.285)).toEqual({ num: 14285, den: 1000 });
  });

  it("rejects nonsense", () => {
    expect(() => frameRateFromNumber(0)).toThrow(RangeError);
    expect(() => frameRateFromNumber(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatTimecode", () => {
  it("formats hours, minutes, seconds and frames", () => {
    expect(formatTimecode(0, FPS_30)).toBe("00:00:00:00");
    expect(formatTimecode(frameToMicros(29, FPS_30), FPS_30)).toBe(
      "00:00:00:29",
    );
    expect(formatTimecode(secondsToMicros(3725.5), FPS_25)).toBe(
      "01:02:05:12",
    );
  });

  it("clamps negative times to zero", () => {
    expect(formatTimecode(-500, FPS_24)).toBe("00:00:00:00");
  });
});
