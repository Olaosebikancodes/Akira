import { describe, expect, it } from "vitest";
import { IDENTITY_TRANSFORM, NO_CROP, type Transform } from "../project/model";
import { coverScale, type LayerInput, layerGeometry, pointInQuad } from "./geometry";
import { transformPoint } from "./orientation";

function geometry(overrides: Partial<LayerInput> = {}, transform: Partial<Transform> = {}) {
  return layerGeometry({
    displayWidth: 1920,
    displayHeight: 1080,
    rotation: 0,
    flip: false,
    crop: NO_CROP,
    canvasWidth: 1920,
    canvasHeight: 1080,
    ...overrides,
    transform: { ...IDENTITY_TRANSFORM, ...transform },
  });
}

function rounded(points: readonly (readonly [number, number])[]) {
  return points.map(([x, y]) => [Math.round(x) + 0, Math.round(y) + 0]);
}

describe("layerGeometry", () => {
  it("fills a canvas of the same shape", () => {
    expect(rounded(geometry().corners)).toEqual([
      [0, 0],
      [1920, 0],
      [1920, 1080],
      [0, 1080],
    ]);
  });

  it("fits inside a canvas of a different shape", () => {
    const vertical = geometry({ canvasWidth: 1080, canvasHeight: 1920 });
    expect(rounded(vertical.corners)).toEqual([
      [0, 656],
      [1080, 656],
      [1080, 1264],
      [0, 1264],
    ]);
  });

  it("scales around the centre and moves relative to the canvas size", () => {
    expect(rounded(geometry({}, { scale: 0.5, x: 0.25 }).corners)).toEqual([
      [960, 270],
      [1920, 270],
      [1920, 810],
      [960, 810],
    ]);
  });

  it("rotates clockwise around the centre", () => {
    const square = geometry({ displayWidth: 100, displayHeight: 100, canvasWidth: 100, canvasHeight: 100 }, { rotation: 90 });
    // The picture's top-left corner ends up at the top-right.
    expect(rounded(square.corners)[0]).toEqual([100, 0]);
  });

  it("mirrors when flipped", () => {
    expect(rounded(geometry({}, { flipX: true }).corners)[0]).toEqual([1920, 0]);
    expect(rounded(geometry({}, { flipY: true }).corners)[0]).toEqual([0, 1080]);
  });

  it("crops without moving or zooming what remains", () => {
    const cropped = geometry({ crop: { ...NO_CROP, left: 0.5 } });
    expect(rounded(cropped.corners)).toEqual([
      [960, 0],
      [1920, 0],
      [1920, 1080],
      [960, 1080],
    ]);
    // The visible area's left edge samples the middle of the texture.
    expect(transformPoint(cropped.texture, 0, 0)).toEqual([0.5, 0]);
    expect(transformPoint(cropped.texture, 1, 1)).toEqual([1, 1]);
  });

  it("combines the file's own rotation with cropping", () => {
    const phone = geometry({ displayWidth: 1080, displayHeight: 1920, rotation: 90, crop: { ...NO_CROP, top: 0.5 } });
    // Display top-left (after the crop, halfway down) maps into the rotated texture.
    expect(transformPoint(phone.texture, 0, 0)).toEqual([0.5, 1]);
  });
});

describe("coverScale", () => {
  it("is how much bigger than fit a picture must be to fill the canvas", () => {
    expect(coverScale(1920, 1080, 1080, 1920)).toBeCloseTo(1920 / 607.5);
    expect(coverScale(1920, 1080, 1920, 1080)).toBe(1);
  });
});

describe("pointInQuad", () => {
  const diamond = [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ] as const;

  it("detects points inside a rotated quad", () => {
    expect(pointInQuad([50, 50], diamond)).toBe(true);
    expect(pointInQuad([10, 10], diamond)).toBe(false);
    expect(pointInQuad([90, 50], diamond)).toBe(true);
  });
});
