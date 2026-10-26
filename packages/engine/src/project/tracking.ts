import type { TrackPoint } from "../jobs/analyze";
import { layerGeometry, type Mat3 } from "../render/geometry";
import { transformPoint } from "../render/orientation";
import type { Micros } from "../time";
import { keyframeClock, transformAt } from "./keyframes";
import type { Clip, Id, Keyframe, KeyframeProperty, Project } from "./model";
import { assetOf, locateClip } from "./query";
import { clipEnd, toTimelineTime } from "./timing";

/** How far a thinned path may stray from the tracked one: a fraction of the canvas, and of the size. */
const POSITION_TOLERANCE = 0.0015;
const SCALE_TOLERANCE = 0.004;

export interface TrackingOptions {
  /** Grow and shrink with the tracked object as well as following it. */
  followScale: boolean;
}

/**
 * Makes `followerId` follow something tracked in `targetId`. Its position,
 * and its size if asked, become keyframes over the tracked span, thinned to
 * the fewest that keep it on course so they're easy to adjust by hand. It
 * keeps where it sat relative to the tracked spot at the first frame.
 */
export function applyTracking(project: Project, followerId: Id, targetId: Id, points: readonly TrackPoint[], options: TrackingOptions): Project {
  const follower = locateClip(project, followerId);
  const target = locateClip(project, targetId)?.clip;
  const size = target && assetOf(project, target).video;
  if (!follower || follower.track.locked || !target || !size) return project;
  const { clip } = follower;
  const { width, height } = project.canvas;

  // Each tracked point as a place on the canvas, at the moment it's shown.
  const placed = points
    .map((point) => {
      const time = toTimelineTime(target, point.time);
      const [x, y] = onCanvas(target, size, width, height, time, point.x, point.y);
      return { time, x: x / width - 0.5, y: y / height - 0.5, scale: point.scale };
    })
    .filter((point) => point.time >= clip.start && point.time < clipEnd(clip));
  if (placed.length < 2) return project;

  const first = placed[0]!;
  const start = transformAt(clip, first.time);
  const series: Partial<Record<KeyframeProperty, { time: Micros; value: number }[]>> = {
    x: placed.map((p) => ({ time: p.time, value: p.x - first.x + start.x })),
    y: placed.map((p) => ({ time: p.time, value: p.y - first.y + start.y })),
  };
  if (options.followScale) series.scale = placed.map((p) => ({ time: p.time, value: (start.scale * p.scale) / first.scale }));

  const keyframes = { ...clip.keyframes };
  const from = keyframeClock(clip, first.time);
  const to = keyframeClock(clip, placed.at(-1)!.time);
  for (const [property, values] of Object.entries(series) as [KeyframeProperty, { time: Micros; value: number }[]][]) {
    const kept = thin(values, property === "scale" ? SCALE_TOLERANCE : POSITION_TOLERANCE);
    // Tracking replaces what was keyed over its span and leaves the rest.
    const outside = (keyframes[property] ?? []).filter((k) => k.time < from || k.time > to);
    const tracked: Keyframe[] = kept.map((p) => ({ time: keyframeClock(clip, p.time), value: p.value, easing: "linear" }));
    keyframes[property] = [...outside, ...tracked].sort((a, b) => a.time - b.time);
  }
  return replaceClipIn(project, follower.trackIndex, { ...clip, keyframes });
}

/** Where a point of a clip's picture (fractions of its full frame) sits on the canvas at `time`. */
function onCanvas(clip: Clip, size: { width: number; height: number }, width: number, height: number, time: Micros, px: number, py: number): [number, number] {
  const { crop } = clip;
  const geometry = layerGeometry({
    displayWidth: size.width,
    displayHeight: size.height,
    rotation: 0,
    flip: false,
    transform: transformAt(clip, time),
    crop,
    canvasWidth: width,
    canvasHeight: height,
  });
  const u = (px - crop.left) / (1 - crop.left - crop.right);
  const v = (py - crop.top) / (1 - crop.top - crop.bottom);
  return transformPoint(geometry.model, u, v);
}

/** Where a canvas point falls on a layer's picture, in fractions of its full frame. The inverse of placing it. */
export function canvasToPicture(model: Mat3, crop: Clip["crop"], x: number, y: number): [number, number] {
  // The model is affine: unit square to canvas. Invert its 2×2 part and translation.
  const [a, b, , c, d, , e, f] = model as unknown as number[];
  const determinant = a! * d! - b! * c!;
  const dx = x - e!;
  const dy = y - f!;
  const u = (d! * dx - c! * dy) / determinant;
  const v = (a! * dy - b! * dx) / determinant;
  return [crop.left + u * (1 - crop.left - crop.right), crop.top + v * (1 - crop.top - crop.bottom)];
}

/**
 * Ramer–Douglas–Peucker: keeps the points a straight line between their
 * neighbours can't stand in for, within `tolerance`. The ends always stay.
 */
export function thin<T extends { time: Micros; value: number }>(points: readonly T[], tolerance: number): T[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points.at(-1)!;
  let worst = 0;
  let worstIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const t = (p.time - first.time) / (last.time - first.time || 1);
    const distance = Math.abs(p.value - (first.value + (last.value - first.value) * t));
    if (distance > worst) {
      worst = distance;
      worstIndex = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [...thin(points.slice(0, worstIndex + 1), tolerance).slice(0, -1), ...thin(points.slice(worstIndex), tolerance)];
}

function replaceClipIn(project: Project, trackIndex: number, clip: Clip): Project {
  return {
    ...project,
    tracks: project.tracks.map((track, index) =>
      index === trackIndex ? { ...track, clips: track.clips.map((c) => (c.id === clip.id ? clip : c)) } : track,
    ),
  };
}
