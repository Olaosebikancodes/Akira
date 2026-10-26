import { type GrayImage, gradients, type Point, sampleAt } from "./image";

export interface FlowResult {
  /** Where the point is in the next image. */
  point: Point;
  /** False when the point couldn't be followed, e.g. it left the image or has no texture. */
  found: boolean;
}

export interface FlowOptions {
  /** Half the side of the square compared around each point, in pixels. */
  radius?: number;
  iterations?: number;
}

/** Pyramid levels with their gradients, computed once per frame and reused for every point. */
export interface FlowLevel {
  image: GrayImage;
  gx: Float32Array;
  gy: Float32Array;
}

export function flowLevels(images: readonly GrayImage[]): FlowLevel[] {
  return images.map((image) => ({ image, ...gradients(image) }));
}

/**
 * Pyramidal Lucas–Kanade optical flow (Bouguet's formulation): follows
 * each point from `previous` to `next`. Coarse levels catch large
 * movements, finer levels refine them to a fraction of a pixel.
 */
export function trackPoints(previous: readonly FlowLevel[], next: readonly FlowLevel[], points: readonly Point[], options: FlowOptions = {}): FlowResult[] {
  const { radius = 7, iterations = 15 } = options;
  const levels = Math.min(previous.length, next.length);
  return points.map((point) => {
    let guessX = 0;
    let guessY = 0;
    for (let level = levels - 1; level >= 0; level--) {
      const scale = 2 ** level;
      const { image: before, gx, gy } = previous[level]!;
      const after = next[level]!.image;
      const px = point[0] / scale;
      const py = point[1] / scale;

      // The gradient matrix of the window in the previous image.
      let gxx = 0;
      let gyy = 0;
      let gxy = 0;
      const window: { ix: number; iy: number; value: number; x: number; y: number }[] = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = px + dx;
          const y = py + dy;
          const ix = sampleGradient(gx, before, x, y);
          const iy = sampleGradient(gy, before, x, y);
          gxx += ix * ix;
          gyy += iy * iy;
          gxy += ix * iy;
          window.push({ ix, iy, value: sampleAt(before, x, y), x: dx, y: dy });
        }
      }
      const determinant = gxx * gyy - gxy * gxy;
      // Flat or edge-only windows can't say how they moved.
      if (determinant < 1e-6 || minEigen(gxx, gyy, gxy) / window.length < 1e-3) {
        return { point, found: false };
      }

      let vx = 0;
      let vy = 0;
      for (let k = 0; k < iterations; k++) {
        let bx = 0;
        let by = 0;
        for (const w of window) {
          const difference = w.value - sampleAt(after, px + guessX + vx + w.x, py + guessY + vy + w.y);
          bx += difference * w.ix;
          by += difference * w.iy;
        }
        const ex = (gyy * bx - gxy * by) / determinant;
        const ey = (gxx * by - gxy * bx) / determinant;
        vx += ex;
        vy += ey;
        if (ex * ex + ey * ey < 1e-4) break;
      }
      guessX = level > 0 ? 2 * (guessX + vx) : guessX + vx;
      guessY = level > 0 ? 2 * (guessY + vy) : guessY + vy;
    }
    const x = point[0] + guessX;
    const y = point[1] + guessY;
    const { width, height } = next[0]!.image;
    return { point: [x, y], found: x >= 0 && y >= 0 && x < width && y < height };
  });
}

function sampleGradient(gradient: Float32Array, image: GrayImage, x: number, y: number): number {
  return sampleAt({ width: image.width, height: image.height, data: gradient }, x, y);
}

function minEigen(xx: number, yy: number, xy: number): number {
  return (xx + yy) / 2 - Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
}
