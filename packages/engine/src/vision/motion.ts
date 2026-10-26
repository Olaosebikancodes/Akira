import type { Point } from "./image";

/**
 * A similarity transform: rotate, scale evenly, then move.
 * x' = a·x − b·y + tx,  y' = b·x + a·y + ty, where a = s·cos θ and b = s·sin θ.
 */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export const IDENTITY_SIMILARITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 };

export function applySimilarity({ a, b, tx, ty }: Similarity, [x, y]: Point): Point {
  return [a * x - b * y + tx, b * x + a * y + ty];
}

export interface FitOptions {
  /** How far, in pixels, a point may land from where the fit puts it and still agree. */
  threshold?: number;
  attempts?: number;
  /** Seeds the random choices, so the same input always gives the same answer. */
  seed?: number;
}

/**
 * Finds the similarity that best maps `from` onto `to`, ignoring points that
 * moved on their own, like people walking through a shot. RANSAC tries fits
 * from random pairs and keeps the one most points agree with, then refits
 * on those.
 */
export function fitSimilarity(from: readonly Point[], to: readonly Point[], options: FitOptions = {}): { transform: Similarity; inliers: number } | null {
  const { threshold = 1.5, attempts = 200 } = options;
  const count = Math.min(from.length, to.length);
  if (count < 2) return null;
  const random = seededRandom(options.seed ?? 1);

  let bestInliers: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const i = Math.floor(random() * count);
    const j = Math.floor(random() * count);
    if (i === j) continue;
    const guess = leastSquares([from[i]!, from[j]!], [to[i]!, to[j]!]);
    if (!guess) continue;
    const inliers = agreeing(guess, from, to, threshold);
    if (inliers.length > bestInliers.length) bestInliers = inliers;
    if (bestInliers.length === count) break;
  }
  if (bestInliers.length < 2) return null;
  const refined = leastSquares(
    bestInliers.map((k) => from[k]!),
    bestInliers.map((k) => to[k]!),
  );
  return refined ? { transform: refined, inliers: bestInliers.length } : null;
}

/** The closed-form least-squares similarity between point sets, about their centroids. */
export function leastSquares(from: readonly Point[], to: readonly Point[]): Similarity | null {
  const n = from.length;
  let fx = 0;
  let fy = 0;
  let gx = 0;
  let gy = 0;
  for (let k = 0; k < n; k++) {
    fx += from[k]![0];
    fy += from[k]![1];
    gx += to[k]![0];
    gy += to[k]![1];
  }
  fx /= n;
  fy /= n;
  gx /= n;
  gy /= n;
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let k = 0; k < n; k++) {
    const x = from[k]![0] - fx;
    const y = from[k]![1] - fy;
    const u = to[k]![0] - gx;
    const v = to[k]![1] - gy;
    dot += x * u + y * v;
    cross += x * v - y * u;
    norm += x * x + y * y;
  }
  if (norm < 1e-9) return null;
  const a = dot / norm;
  const b = cross / norm;
  return { a, b, tx: gx - (a * fx - b * fy), ty: gy - (b * fx + a * fy) };
}

function agreeing(transform: Similarity, from: readonly Point[], to: readonly Point[], threshold: number): number[] {
  const result: number[] = [];
  for (let k = 0; k < Math.min(from.length, to.length); k++) {
    const [x, y] = applySimilarity(transform, from[k]!);
    if ((x - to[k]![0]) ** 2 + (y - to[k]![1]) ** 2 <= threshold * threshold) result.push(k);
  }
  return result;
}

/** A small deterministic generator (a linear congruential one), good enough for picking samples. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
