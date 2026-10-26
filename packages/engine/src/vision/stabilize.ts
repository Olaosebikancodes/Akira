import type { CameraMotion } from "../project/model";
import type { Micros } from "../time";
import type { Similarity } from "./motion";

/** How the camera moved between two frames, in fractions of the frame, radians and a scale ratio. */
export interface FrameMotion {
  x: number;
  y: number;
  angle: number;
  /** Natural log of the zoom between frames, so zooms add up like the rest. */
  logScale: number;
}

/**
 * Splits a frame-to-frame similarity (fitted about the frame's centre) into
 * its parts, with movement as fractions of the frame so the analysis size
 * doesn't matter later.
 */
export function frameMotion(transform: Similarity, width: number, height: number): FrameMotion {
  return {
    x: transform.tx / width,
    y: transform.ty / height,
    angle: Math.atan2(transform.b, transform.a),
    logScale: Math.log(Math.hypot(transform.a, transform.b)),
  };
}

/** Adds up frame-to-frame motion into the camera's path, starting from rest. */
export function cameraPath(times: readonly Micros[], motions: readonly FrameMotion[]): CameraMotion["frames"] {
  const frames: CameraMotion["frames"] = [];
  let x = 0;
  let y = 0;
  let angle = 0;
  let logScale = 0;
  times.forEach((time, i) => {
    if (i > 0) {
      const motion = motions[i - 1]!;
      x += motion.x;
      y += motion.y;
      angle += motion.angle;
      logScale += motion.logScale;
    }
    frames.push({ time, x, y, angle, logScale });
  });
  return frames;
}

/** The change that moves a frame from where the camera was to where a steady camera would have been. */
export interface Correction {
  x: number;
  y: number;
  angle: number;
  scale: number;
}

export interface Stabilization {
  /** The correction for a source time, eased between analysed frames. */
  at(time: Micros): Correction;
  /** How much to zoom in so the frame's moving edges never show. */
  zoom: number;
}

const NONE: Correction = { x: 0, y: 0, angle: 0, scale: 1 };
const cache = new WeakMap<CameraMotion, Map<number, Stabilization>>();

/**
 * Smooths the camera's path with a Gaussian and returns how far each frame
 * must move to follow the smooth path instead. `strength` (0 to 1) sets how
 * much shake is removed, from a light touch to tripod-steady.
 */
export function stabilization(motion: CameraMotion, strength: number): Stabilization {
  let byStrength = cache.get(motion);
  if (!byStrength) {
    byStrength = new Map();
    cache.set(motion, byStrength);
  }
  const cached = byStrength.get(strength);
  if (cached) return cached;

  const { frames } = motion;
  // Seconds of smoothing either side: 0.15 s barely steadies, 1.5 s holds the frame still.
  const sigma = (0.15 + Math.max(0, Math.min(1, strength)) * 1.35) * 1_000_000;
  const corrections = frames.map((frame) => {
    let x = 0;
    let y = 0;
    let angle = 0;
    let logScale = 0;
    let total = 0;
    for (const other of frames) {
      const distance = other.time - frame.time;
      if (Math.abs(distance) > 3 * sigma) continue;
      const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
      x += other.x * weight;
      y += other.y * weight;
      angle += other.angle * weight;
      logScale += other.logScale * weight;
      total += weight;
    }
    return {
      time: frame.time,
      x: x / total - frame.x,
      y: y / total - frame.y,
      angle: angle / total - frame.angle,
      scale: Math.exp(logScale / total - frame.logScale),
    };
  });

  // Zoom in just enough to cover the furthest any frame moves.
  const reach = corrections.reduce(
    (most, c) => Math.max(most, 2 * Math.max(Math.abs(c.x), Math.abs(c.y)) + Math.abs(c.angle) + Math.abs(1 - c.scale)),
    0,
  );
  const zoom = Math.min(1.6, 1 + reach);

  const result: Stabilization = {
    zoom,
    at(time) {
      if (corrections.length === 0) return NONE;
      let low = 0;
      let high = corrections.length - 1;
      if (time <= corrections[0]!.time) return corrections[0]!;
      if (time >= corrections[high]!.time) return corrections[high]!;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (corrections[middle]!.time <= time) low = middle;
        else high = middle;
      }
      const a = corrections[low]!;
      const b = corrections[high]!;
      const t = (time - a.time) / (b.time - a.time);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: a.angle + (b.angle - a.angle) * t,
        scale: a.scale + (b.scale - a.scale) * t,
      };
    },
  };
  byStrength.set(strength, result);
  return result;
}
