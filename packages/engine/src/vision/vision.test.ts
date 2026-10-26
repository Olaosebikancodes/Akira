import { describe, expect, it } from "vitest";
import type { CameraMotion } from "../project/model";
import { goodFeatures } from "./features";
import { flowLevels, trackPoints } from "./flow";
import { type GrayImage, type Point, pyramid } from "./image";
import { applySimilarity, fitSimilarity, leastSquares, type Similarity } from "./motion";
import { cameraPath, frameMotion, stabilization } from "./stabilize";
import { RegionTracker } from "./track";

const WIDTH = 160;
const HEIGHT = 120;

/** A smooth, busy texture: overlapping waves at several scales, like foliage or gravel. */
function texture(x: number, y: number): number {
  return (
    128 +
    40 * Math.sin(x * 0.31 + y * 0.17) +
    30 * Math.sin(x * 0.11 - y * 0.29 + 1.3) +
    25 * Math.sin(x * 0.53 + y * 0.47) * Math.cos(y * 0.23) +
    20 * Math.cos(x * 0.07 * y * 0.05)
  );
}

/** Renders the texture as seen after the scene moved by `move` (content at p shows at move(p)). */
function frame(move: Similarity = { a: 1, b: 0, tx: 0, ty: 0 }, scene = texture): GrayImage {
  // Invert the similarity to find which scene point lands on each pixel.
  const { a, b, tx, ty } = move;
  const det = a * a + b * b;
  const data = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = x - tx;
      const v = y - ty;
      data[y * WIDTH + x] = scene((a * u + b * v) / det, (-b * u + a * v) / det);
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

function median(values: number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  return sorted[sorted.length >> 1]!;
}

describe("goodFeatures", () => {
  it("finds corners spread across textured ground", () => {
    const points = goodFeatures(frame(), { maxCount: 50, minDistance: 10 });
    expect(points.length).toBe(50);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1])).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("finds none in a flat picture, and keeps to a region when asked", () => {
    const flat = { width: WIDTH, height: HEIGHT, data: new Float32Array(WIDTH * HEIGHT).fill(90) };
    expect(goodFeatures(flat)).toEqual([]);
    for (const [x, y] of goodFeatures(frame(), { region: [40, 30, 40, 30] })) {
      expect(x).toBeGreaterThanOrEqual(40);
      expect(x).toBeLessThan(80);
      expect(y).toBeGreaterThanOrEqual(30);
      expect(y).toBeLessThan(60);
    }
  });
});

describe("trackPoints", () => {
  it("measures a shift to a fraction of a pixel, even several pixels long", () => {
    const before = flowLevels(pyramid(frame(), 3));
    const after = flowLevels(pyramid(frame({ a: 1, b: 0, tx: 6.4, ty: -3.7 }), 3));
    const points = goodFeatures(before[0]!.image, { maxCount: 40, region: [20, 20, 120, 80] });
    const flows = trackPoints(before, after, points).filter((f) => f.found);
    expect(flows.length).toBeGreaterThan(30);
    expect(median(flows.map((f, i) => f.point[0] - points[i]![0]))).toBeCloseTo(6.4, 1);
    expect(median(flows.map((f, i) => f.point[1] - points[i]![1]))).toBeCloseTo(-3.7, 1);
  });
});

describe("fitSimilarity", () => {
  const truth: Similarity = { a: Math.cos(0.05) * 1.02, b: Math.sin(0.05) * 1.02, tx: 4, ty: -2 };

  it("recovers a rotation, zoom and shift, ignoring points that moved on their own", () => {
    const from: Point[] = Array.from({ length: 40 }, (_, i) => [(i * 37) % 150, (i * 53) % 110]);
    const to = from.map((p, i) => (i % 5 === 0 ? ([p[0] + 25, p[1] - 30] as Point) : applySimilarity(truth, p)));
    const fit = fitSimilarity(from, to)!;
    expect(fit.inliers).toBe(32);
    expect(fit.transform.a).toBeCloseTo(truth.a, 6);
    expect(fit.transform.b).toBeCloseTo(truth.b, 6);
    expect(fit.transform.tx).toBeCloseTo(4, 5);
  });

  it("solves two points exactly and refuses one", () => {
    expect(leastSquares([[0, 0], [10, 0]], [[1, 1], [1, 11]])).toMatchObject({ a: expect.closeTo(0, 9), b: 1 });
    expect(fitSimilarity([[0, 0]], [[1, 1]])).toBeNull();
  });
});

describe("stabilization", () => {
  /** A camera drifting steadily right while shaking up and down every other frame. */
  function shaky(): CameraMotion {
    const times = Array.from({ length: 61 }, (_, i) => Math.round((i * 1_000_000) / 30));
    const motions = times.slice(1).map((_, i) => ({ x: 0.005, y: i % 2 === 0 ? 0.02 : -0.02, angle: 0, logScale: 0 }));
    return { start: 0, end: 2_000_000, frames: cameraPath(times, motions) };
  }

  it("cancels the shake but keeps the drift", () => {
    const motion = shaky();
    const steady = stabilization(motion, 0.5);
    const path = motion.frames.map((f) => f.y + steady.at(f.time).y);
    const before = Math.max(...motion.frames.map((f) => f.y)) - Math.min(...motion.frames.map((f) => f.y));
    const after = Math.max(...path.slice(10, 50)) - Math.min(...path.slice(10, 50));
    expect(after).toBeLessThan(before / 5);
    // The drift right is camera work, not shake, so the middle frames barely move sideways.
    expect(Math.abs(steady.at(1_000_000).x)).toBeLessThan(0.02);
  });

  it("zooms in just enough to hide the edges, and never more than 1.6×", () => {
    const steady = stabilization(shaky(), 1);
    expect(steady.zoom).toBeGreaterThan(1);
    expect(steady.zoom).toBeLessThanOrEqual(1.6);
  });

  it("splits frame-to-frame motion into parts", () => {
    const motion = frameMotion({ a: Math.cos(0.1) * 2, b: Math.sin(0.1) * 2, tx: 16, ty: -12 }, 160, 120);
    expect(motion.x).toBeCloseTo(0.1);
    expect(motion.y).toBeCloseTo(-0.1);
    expect(motion.angle).toBeCloseTo(0.1);
    expect(motion.logScale).toBeCloseTo(Math.log(2));
  });
});

describe("RegionTracker", () => {
  it("follows a patch across a moving scene", () => {
    let box = { x: 80, y: 60, width: 40, height: 30 };
    const tracker = new RegionTracker(flowLevels(pyramid(frame(), 3)), box);
    for (let step = 1; step <= 10; step++) {
      box = tracker.next(flowLevels(pyramid(frame({ a: 1, b: 0, tx: step * 2.5, ty: step * 1.2 }), 3)));
    }
    expect(tracker.following).toBe(true);
    expect(box.x).toBeCloseTo(105, 0);
    expect(box.y).toBeCloseTo(72, 0);
    expect(box.width).toBeCloseTo(40, 0);
  });
});
