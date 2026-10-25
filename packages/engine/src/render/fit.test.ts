import { describe, expect, it } from "vitest";
import { fitContain } from "./fit";

describe("fitContain", () => {
  it("fills the frame when the aspect ratios match", () => {
    expect(fitContain(3840, 2160, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it("pillarboxes landscape footage on a vertical canvas", () => {
    expect(fitContain(1920, 1080, 1080, 1920)).toEqual({
      x: 0,
      y: 656.25,
      width: 1080,
      height: 607.5,
    });
  });

  it("letterboxes vertical footage on a landscape canvas", () => {
    expect(fitContain(1080, 1920, 1920, 1080)).toEqual({
      x: 656.25,
      y: 0,
      width: 607.5,
      height: 1080,
    });
  });
});
