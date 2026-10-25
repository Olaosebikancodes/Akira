import { describe, expect, it } from "vitest";
import { type Clip, IDENTITY_TRANSFORM, NO_AUDIO_FILTERS, NO_CROP } from "./model";
import { clipContains, clipDuration, clipEnd, sourceTimeAt } from "./timing";

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip",
    assetId: "asset",
    start: 1_000_000,
    sourceIn: 2_000_000,
    sourceOut: 6_000_000,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    audioFilters: NO_AUDIO_FILTERS,
    transform: IDENTITY_TRANSFORM,
    crop: NO_CROP,
    ...overrides,
  };
}

describe("clipDuration", () => {
  it("equals the source range at normal speed", () => {
    expect(clipDuration(clip())).toBe(4_000_000);
  });

  it("shrinks when sped up and grows when slowed down", () => {
    expect(clipDuration(clip({ speed: 2 }))).toBe(2_000_000);
    expect(clipDuration(clip({ speed: 0.5 }))).toBe(8_000_000);
  });

  it("stays a whole number of microseconds", () => {
    expect(Number.isInteger(clipDuration(clip({ speed: 3 })))).toBe(true);
  });
});

describe("clipContains", () => {
  it("includes the start and excludes the end", () => {
    const c = clip();
    expect(clipContains(c, 999_999)).toBe(false);
    expect(clipContains(c, 1_000_000)).toBe(true);
    expect(clipContains(c, clipEnd(c) - 1)).toBe(true);
    expect(clipContains(c, clipEnd(c))).toBe(false);
  });
});

describe("sourceTimeAt", () => {
  it("maps the clip start to the source in-point", () => {
    expect(sourceTimeAt(clip(), 1_000_000)).toBe(2_000_000);
  });

  it("advances through the source at the clip's speed", () => {
    expect(sourceTimeAt(clip(), 1_500_000)).toBe(2_500_000);
    expect(sourceTimeAt(clip({ speed: 2 }), 1_500_000)).toBe(3_000_000);
    expect(sourceTimeAt(clip({ speed: 0.5 }), 1_500_000)).toBe(2_250_000);
  });

  it("never leaves the source range", () => {
    expect(sourceTimeAt(clip(), 0)).toBe(2_000_000);
    expect(sourceTimeAt(clip(), 60_000_000)).toBe(5_999_999);
  });
});
