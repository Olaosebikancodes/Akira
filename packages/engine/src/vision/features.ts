import { type GrayImage, gradients, type Point } from "./image";

export interface FeatureOptions {
  /** Most corners to return. */
  maxCount?: number;
  /** Corners weaker than this fraction of the strongest are dropped. */
  quality?: number;
  /** Corners closer than this, in pixels, are thinned to the strongest. */
  minDistance?: number;
  /** Only look inside this rectangle: x, y, width, height. */
  region?: readonly [number, number, number, number];
}

/**
 * Shi–Tomasi "good features to track": points where brightness changes in
 * every direction, so their motion can be measured in both axes. Each
 * pixel scores the smaller eigenvalue of its local gradient matrix.
 */
export function goodFeatures(image: GrayImage, options: FeatureOptions = {}): Point[] {
  const { maxCount = 200, quality = 0.01, minDistance = 8 } = options;
  const { width, height } = image;
  const { gx, gy } = gradients(image);
  const [rx, ry, rw, rh] = options.region ?? [0, 0, width, height];
  const x0 = Math.max(2, Math.floor(rx));
  const y0 = Math.max(2, Math.floor(ry));
  const x1 = Math.min(width - 2, Math.ceil(rx + rw));
  const y1 = Math.min(height - 2, Math.ceil(ry + rh));

  const scores = new Float32Array(width * height);
  let best = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Sum the gradient products over a 3×3 window.
      let xx = 0;
      let yy = 0;
      let xy = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (y + dy) * width + x + dx;
          xx += gx[i]! * gx[i]!;
          yy += gy[i]! * gy[i]!;
          xy += gx[i]! * gy[i]!;
        }
      }
      const half = (xx + yy) / 2;
      const score = half - Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
      scores[y * width + x] = score;
      if (score > best) best = score;
    }
  }
  if (best <= 0) return [];

  // Keep local maxima above the threshold, strongest first.
  const threshold = best * quality;
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const score = scores[y * width + x]!;
      if (score < threshold) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && scores[(y + dy) * width + x + dx]! > score) {
            peak = false;
            break;
          }
        }
      }
      if (peak) candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // A coarse grid makes the minimum-distance check cheap.
  const cell = Math.max(1, minDistance);
  const columns = Math.ceil(width / cell);
  const grid = new Map<number, Point[]>();
  const result: Point[] = [];
  for (const { x, y } of candidates) {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let close = false;
    for (let gy2 = cy - 1; gy2 <= cy + 1 && !close; gy2++) {
      for (let gx2 = cx - 1; gx2 <= cx + 1 && !close; gx2++) {
        for (const [px, py] of grid.get(gy2 * columns + gx2) ?? []) {
          if ((px - x) ** 2 + (py - y) ** 2 < minDistance * minDistance) {
            close = true;
            break;
          }
        }
      }
    }
    if (close) continue;
    const point: Point = [x, y];
    result.push(point);
    const key = cy * columns + cx;
    grid.set(key, [...(grid.get(key) ?? []), point]);
    if (result.length >= maxCount) break;
  }
  return result;
}
