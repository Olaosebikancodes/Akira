import type { Crop, Transform } from "../project/model";
import { type Rotation, textureTransform, transformPoint } from "./orientation";

/** A 3x3 matrix in WebGL's column-major order. */
export type Mat3 = Float32Array;
export type Point = readonly [number, number];

export interface LayerInput {
  /** Size of the picture as displayed, after the file's own rotation. */
  displayWidth: number;
  displayHeight: number;
  /** Orientation stored in the file, e.g. by a phone held sideways. */
  rotation: Rotation;
  flip: boolean;
  transform: Transform;
  crop: Crop;
  canvasWidth: number;
  canvasHeight: number;
}

export interface LayerGeometry {
  /** Maps the unit square over the visible (cropped) picture to canvas pixels. */
  model: Mat3;
  /** Maps the same unit square to texture coordinates. */
  texture: Mat3;
  /** Corners in canvas pixels: top-left, top-right, bottom-right, bottom-left. */
  corners: [Point, Point, Point, Point];
}

/**
 * Where a picture lands on the canvas. At scale 1 the uncropped picture fits
 * inside the canvas; cropping hides edges without moving or zooming what
 * remains. Rotation is clockwise around the picture's centre, and flips
 * mirror it in place.
 */
export function layerGeometry(input: LayerInput): LayerGeometry {
  const { displayWidth, displayHeight, canvasWidth, canvasHeight, transform, crop } = input;
  const fit = Math.min(canvasWidth / displayWidth, canvasHeight / displayHeight);
  const width = displayWidth * fit * transform.scale * (transform.flipX ? -1 : 1);
  const height = displayHeight * fit * transform.scale * (transform.flipY ? -1 : 1);
  const centreX = canvasWidth / 2 + transform.x * canvasWidth;
  const centreY = canvasHeight / 2 + transform.y * canvasHeight;
  const angle = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const visibleWidth = 1 - crop.left - crop.right;
  const visibleHeight = 1 - crop.top - crop.bottom;
  // Before rotation, unit point (u, v) sits at (ax*u + bx, ay*v + by) from the centre.
  const ax = visibleWidth * width;
  const bx = (crop.left - 0.5) * width;
  const ay = visibleHeight * height;
  const by = (crop.top - 0.5) * height;

  const model = new Float32Array([
    ax * cos,
    ax * sin,
    0,
    -ay * sin,
    ay * cos,
    0,
    centreX + bx * cos - by * sin,
    centreY + bx * sin + by * cos,
    1,
  ]);
  const cropMatrix = new Float32Array([visibleWidth, 0, 0, 0, visibleHeight, 0, crop.left, crop.top, 1]);
  const texture = multiply(textureTransform(input.rotation, input.flip), cropMatrix);

  return {
    model,
    texture,
    corners: [
      transformPoint(model, 0, 0),
      transformPoint(model, 1, 0),
      transformPoint(model, 1, 1),
      transformPoint(model, 0, 1),
    ],
  };
}

/** The scale at which a picture covers the whole canvas, cropping what overflows. */
export function coverScale(
  displayWidth: number,
  displayHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const fit = Math.min(canvasWidth / displayWidth, canvasHeight / displayHeight);
  const cover = Math.max(canvasWidth / displayWidth, canvasHeight / displayHeight);
  return cover / fit;
}

/** Whether a point lies inside a convex quad given in drawing order. */
export function pointInQuad(point: Point, corners: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const [ax, ay] = corners[i]!;
    const [bx, by] = corners[(i + 1) % corners.length]!;
    const cross = (bx - ax) * (point[1] - ay) - (by - ay) * (point[0] - ax);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** a × b for column-major 3x3 matrices. */
export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Float32Array(9);
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      out[column * 3 + row] =
        a[row]! * b[column * 3]! + a[3 + row]! * b[column * 3 + 1]! + a[6 + row]! * b[column * 3 + 2]!;
    }
  }
  return out;
}
