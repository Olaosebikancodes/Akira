import { describe, expect, it } from "vitest";
import { analyzeColor, correctChannel, NO_CORRECTION } from "./auto-color";

/** RGBA pixels from a function of the pixel index. */
function pixels(count: number, colour: (i: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = colour(i);
    out.set([r, g, b, 255], i * 4);
  }
  return out;
}

describe("analyzeColor", () => {
  it("stretches dull footage to the full range", () => {
    // Every channel only spans 60-190: washed out.
    const dull = pixels(1000, (i) => {
      const v = 60 + Math.round((i / 999) * 130);
      return [v, v, v];
    });
    const correction = analyzeColor(dull);
    expect(correction.black[0]).toBeCloseTo(60 / 255, 1);
    expect(correction.white[0]).toBeCloseTo(190 / 255, 1);
    expect(correctChannel(60 / 255, correction, 0)).toBeCloseTo(0, 1);
    expect(correctChannel(190 / 255, correction, 0)).toBeCloseTo(1, 1);
  });

  it("removes a colour cast by moving each channel on its own", () => {
    // A warm cast: red sits 40 levels above green and blue everywhere.
    const warm = pixels(1000, (i) => {
      const v = Math.round((i / 999) * 200);
      return [v + 40, v, v];
    });
    const { black, white } = analyzeColor(warm);
    expect(black[0]).toBeGreaterThan(black[2] + 0.1);
    // After correction a mid grey has equal red and blue.
    const correction = analyzeColor(warm);
    const red = correctChannel(140 / 255, correction, 0);
    const blue = correctChannel(100 / 255, correction, 2);
    expect(Math.abs(red - blue)).toBeLessThan(0.02);
    expect(white[0]).toBeGreaterThan(white[2]);
  });

  it("ignores a few extreme pixels", () => {
    // Values span 60-220, plus three pure black and three pure white specks.
    const specks = pixels(1000, (i) => {
      if (i < 3) return [0, 0, 0];
      if (i > 996) return [255, 255, 255];
      const v = 60 + (i % 161);
      return [v, v, v];
    });
    const { black, white } = analyzeColor(specks);
    expect(black[0]).toBeCloseTo(60 / 255, 1);
    expect(white[0]).toBeCloseTo(220 / 255, 1);
  });

  it("never stretches a nearly flat frame more than 2.5 times", () => {
    const flat = pixels(500, () => [128, 128, 128]);
    const { black, white } = analyzeColor(flat);
    expect(white[0] - black[0]).toBeCloseTo(0.4);
  });

  it("does nothing with no visible pixels", () => {
    expect(analyzeColor(new Uint8ClampedArray(16))).toEqual(NO_CORRECTION);
  });
});
