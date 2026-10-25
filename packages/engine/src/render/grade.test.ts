import { describe, expect, it } from "vitest";
import { NEUTRAL_ADJUSTMENTS } from "../project/model";
import { gradeColor } from "./grade";

const SKIN = [0.8, 0.6, 0.5] as const;

describe("gradeColor", () => {
  it("leaves colour alone when every adjustment is neutral", () => {
    const graded = gradeColor(SKIN, NEUTRAL_ADJUSTMENTS);
    graded.forEach((value, i) => expect(value).toBeCloseTo(SKIN[i]!, 6));
  });

  it("turns colour grey at -100% saturation", () => {
    const [r, g, b] = gradeColor(SKIN, { ...NEUTRAL_ADJUSTMENTS, saturation: -1 });
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
  });

  it("warms by adding red and taking away blue", () => {
    const [r, , b] = gradeColor(SKIN, { ...NEUTRAL_ADJUSTMENTS, temperature: 0.5 });
    expect(r).toBeGreaterThan(SKIN[0]);
    expect(b).toBeLessThan(SKIN[2]);
  });

  it("doubles brightness per stop of exposure, then clips at white", () => {
    const [r] = gradeColor([0.2, 0.2, 0.2], { ...NEUTRAL_ADJUSTMENTS, exposure: 0.5 });
    expect(r).toBeCloseTo(0.4, 6);
    expect(gradeColor([0.8, 0.8, 0.8], { ...NEUTRAL_ADJUSTMENTS, exposure: 1 })[0]).toBe(1);
  });

  it("pushes values away from mid-grey with contrast", () => {
    const [dark] = gradeColor([0.25, 0.25, 0.25], { ...NEUTRAL_ADJUSTMENTS, contrast: 0.5 });
    const [light] = gradeColor([0.75, 0.75, 0.75], { ...NEUTRAL_ADJUSTMENTS, contrast: 0.5 });
    expect(dark).toBeCloseTo(0.125, 6);
    expect(light).toBeCloseTo(0.875, 6);
  });
});
