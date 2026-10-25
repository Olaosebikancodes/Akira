import { describe, expect, it } from "vitest";
import { rowAt, rulerStep, timeToX, xToTime } from "./layout";

const FRAME = 33_333;

describe("time and pixels", () => {
  it("convert both ways at a zoom level", () => {
    expect(timeToX(2_500_000, 100)).toBe(250);
    expect(xToTime(250, 100)).toBe(2_500_000);
  });
});

describe("rowAt", () => {
  const boxes = [
    { trackId: "overlay", top: 0, bottom: 52 },
    { trackId: "main", top: 52, bottom: 116 },
  ];

  it("finds the track under the pointer", () => {
    expect(rowAt(boxes, 60)).toEqual({ kind: "track", trackId: "main" });
  });

  it("reports empty space above and below the tracks", () => {
    expect(rowAt(boxes, -5)).toEqual({ kind: "above" });
    expect(rowAt(boxes, 200)).toEqual({ kind: "below" });
  });
});

describe("rulerStep", () => {
  it("shows frames when zoomed right in and minutes when zoomed out", () => {
    expect(rulerStep(600, FRAME).major).toBe(FRAME * 5);
    expect(rulerStep(60, FRAME).major).toBe(2_000_000);
    expect(rulerStep(2, FRAME).major).toBe(60_000_000);
  });
});
