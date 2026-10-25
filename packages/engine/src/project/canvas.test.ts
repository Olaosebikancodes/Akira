import { describe, expect, it } from "vitest";
import { canvasSize, currentAspect, originalSize, setAspect } from "./canvas";
import { clip, IMAGE, projectWith, VIDEO } from "./fixtures.test-util";

describe("canvasSize", () => {
  it("puts the short edge at 1080 pixels", () => {
    expect(canvasSize([16, 9])).toEqual({ width: 1920, height: 1080 });
    expect(canvasSize([9, 16])).toEqual({ width: 1080, height: 1920 });
    expect(canvasSize([4, 5])).toEqual({ width: 1080, height: 1350 });
  });

  it("rounds to even numbers for H.264", () => {
    expect(canvasSize([21, 9])).toEqual({ width: 2520, height: 1080 });
    expect(canvasSize([16, 9], 721)).toEqual({ width: 1282, height: 722 });
  });
});

describe("aspect presets", () => {
  const project = projectWith({ clips: [clip("a", VIDEO, 0, 1_000_000)] });

  it("follows the first main-track clip for Original", () => {
    expect(originalSize(project)).toEqual({ width: 1920, height: 1080 });
    expect(originalSize(projectWith({ clips: [clip("i", IMAGE, 0, 1)] }))).toEqual({ width: 800, height: 800 });
    expect(originalSize(projectWith({ clips: [] }))).toBeNull();
  });

  it("switches the canvas and reports the match", () => {
    const vertical = setAspect(project, "9:16");
    expect(vertical.canvas).toMatchObject({ width: 1080, height: 1920 });
    expect(currentAspect(vertical)).toBe("9:16");
    expect(currentAspect(project)).toBe("original");
  });
});
