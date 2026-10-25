import { describe, expect, it } from "vitest";
import { planar } from "./pcm";

describe("planar", () => {
  it("lays channels end to end", () => {
    const audio = { sampleRate: 48_000, channels: [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])] };
    expect([...planar(audio)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("handles silence with no channels", () => {
    expect(planar({ sampleRate: 48_000, channels: [] })).toHaveLength(0);
  });
});
