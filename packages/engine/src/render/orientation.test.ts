import { describe, expect, it } from "vitest";
import { type Rotation, textureTransform, transformPoint } from "./orientation";

const TOP_LEFT = [0, 0] as const;
const TOP_RIGHT = [1, 0] as const;
const BOTTOM_LEFT = [0, 1] as const;

/** Which texture corner ends up at the display's top-left and top-right. */
function corners(rotation: Rotation, flip = false) {
  const matrix = textureTransform(rotation, flip);
  return {
    topLeft: transformPoint(matrix, ...TOP_LEFT),
    topRight: transformPoint(matrix, ...TOP_RIGHT),
  };
}

describe("textureTransform", () => {
  it("leaves unrotated frames alone", () => {
    expect(corners(0)).toEqual({ topLeft: [...TOP_LEFT], topRight: [...TOP_RIGHT] });
  });

  // Rotating 90° clockwise brings the texture's bottom-left corner to the top-left.
  it("rotates 90° clockwise", () => {
    expect(corners(90)).toEqual({ topLeft: [...BOTTOM_LEFT], topRight: [...TOP_LEFT] });
  });

  it("rotates 180°", () => {
    expect(corners(180)).toEqual({ topLeft: [1, 1], topRight: [...BOTTOM_LEFT] });
  });

  it("rotates 270° clockwise", () => {
    expect(corners(270)).toEqual({ topLeft: [...TOP_RIGHT], topRight: [1, 1] });
  });

  it("mirrors flipped frames after rotating", () => {
    expect(corners(0, true)).toEqual({ topLeft: [...TOP_RIGHT], topRight: [...TOP_LEFT] });
    expect(corners(90, true)).toEqual({ topLeft: [...TOP_LEFT], topRight: [...BOTTOM_LEFT] });
  });
});
