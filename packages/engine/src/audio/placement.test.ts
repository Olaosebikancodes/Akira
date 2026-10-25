import { describe, expect, it } from "vitest";
import type { Clip } from "../project/model";
import { placeAudioBuffer } from "./placement";

// Uses source 2s-6s, placed at 1s on the timeline.
const clip: Clip = {
  id: "clip",
  assetId: "asset",
  start: 1_000_000,
  sourceIn: 2_000_000,
  sourceOut: 6_000_000,
  speed: 1,
};

describe("placeAudioBuffer", () => {
  it("places a buffer inside the clip unchanged", () => {
    expect(placeAudioBuffer(clip, 3_000_000, 20_000, 0)).toEqual({
      at: 2_000_000,
      offset: 0,
      duration: 20_000,
    });
  });

  it("trims the part of a buffer before the in-point", () => {
    expect(placeAudioBuffer(clip, 1_990_000, 20_000, 0)).toEqual({
      at: 1_000_000,
      offset: 10_000,
      duration: 10_000,
    });
  });

  it("trims the part of a buffer after the out-point", () => {
    expect(placeAudioBuffer(clip, 5_990_000, 20_000, 0)).toEqual({
      at: 4_990_000,
      offset: 0,
      duration: 10_000,
    });
  });

  it("starts mid-buffer when playback starts mid-clip", () => {
    expect(placeAudioBuffer(clip, 3_000_000, 20_000, 2_005_000)).toEqual({
      at: 2_005_000,
      offset: 5_000,
      duration: 15_000,
    });
  });

  it("skips buffers that are entirely outside what plays", () => {
    expect(placeAudioBuffer(clip, 1_000_000, 20_000, 0)).toBeNull();
    expect(placeAudioBuffer(clip, 6_000_000, 20_000, 0)).toBeNull();
    expect(placeAudioBuffer(clip, 3_000_000, 20_000, 2_100_000)).toBeNull();
  });

  it("keeps offsets in source time when the clip is sped up", () => {
    const fast = { ...clip, speed: 2 };
    // Source 4s is 1s into the clip at 2x, so it plays at timeline 2s.
    expect(placeAudioBuffer(fast, 4_000_000, 20_000, 0)).toEqual({
      at: 2_000_000,
      offset: 0,
      duration: 20_000,
    });
  });
});
