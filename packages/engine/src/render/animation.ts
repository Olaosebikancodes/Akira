import type { Clip, Transform } from "../project/model";
import { clipDuration } from "../project/timing";
import type { Micros } from "../time";

export interface AnimatedLook {
  transform: Transform;
  /** How much of a text clip is typed out, 0 to 1. */
  reveal: number;
}

/** How far a slide moves, as a fraction of the canvas. */
const SLIDE_DISTANCE = 0.08;

/**
 * How a clip looks `time` into the timeline once its animations are
 * applied. In and out animations play over their duration at the clip's
 * edges; loops run for the clip's whole length.
 */
export function animatedLook(clip: Clip, time: Micros): AnimatedLook {
  const animation = clip.animation;
  const transform = { ...clip.transform };
  let reveal = 1;
  if (!animation) return { transform: shaken(clip, transform, time), reveal };

  const into = time - clip.start;
  const length = clipDuration(clip);

  if (animation.in && into < animation.in.duration) {
    const progress = clamp01(into / animation.in.duration);
    const eased = easeOutCubic(progress);
    switch (animation.in.kind) {
      case "fade":
        transform.opacity *= eased;
        break;
      case "pop":
        transform.scale *= 0.6 + 0.4 * easeOutBack(progress);
        transform.opacity *= clamp01(progress * 2);
        break;
      case "slide-up":
        transform.y += (1 - eased) * SLIDE_DISTANCE;
        transform.opacity *= eased;
        break;
      case "slide-left":
        transform.x += (1 - eased) * SLIDE_DISTANCE;
        transform.opacity *= eased;
        break;
      case "typewriter":
        reveal = progress;
        break;
    }
  }

  if (animation.out && length - into < animation.out.duration) {
    // 1 when the out animation starts, 0 at the clip's last moment.
    const remaining = clamp01((length - into) / animation.out.duration);
    const eased = easeOutCubic(remaining);
    switch (animation.out.kind) {
      case "fade":
        transform.opacity *= eased;
        break;
      case "pop":
        transform.scale *= 0.6 + 0.4 * eased;
        transform.opacity *= eased;
        break;
      case "slide-down":
        transform.y += (1 - eased) * SLIDE_DISTANCE;
        transform.opacity *= eased;
        break;
    }
  }

  if (animation.loop && animation.loop.period > 0) {
    const phase = (Math.max(0, into) % animation.loop.period) / animation.loop.period;
    switch (animation.loop.kind) {
      case "pulse":
        transform.scale *= 1 + 0.06 * Math.sin(phase * 2 * Math.PI);
        break;
      case "bounce":
        transform.y -= 0.025 * Math.abs(Math.sin(phase * Math.PI));
        break;
    }
  }

  return { transform: shaken(clip, transform, time), reveal };
}

/**
 * The shake effect jitters a clip's position and angle, zooming in a little
 * so the edges stay hidden. The same time always gives the same offset.
 */
function shaken(clip: Clip, transform: Transform, time: Micros): Transform {
  const amount = clip.effects?.find((effect) => effect.kind === "shake")?.amount ?? 0;
  if (amount <= 0) return transform;
  const t = (time - clip.start) / 1_000_000;
  const seed = clipSeed(clip.id);
  return {
    ...transform,
    x: transform.x + amount * 0.02 * wobble(t, seed),
    y: transform.y + amount * 0.02 * wobble(t, seed + 1),
    rotation: transform.rotation + amount * 1.5 * wobble(t, seed + 2),
    scale: transform.scale * (1 + amount * 0.06),
  };
}

/** Smooth, irregular movement between -1 and 1 from sines whose periods never line up. */
function wobble(t: number, seed: number): number {
  return 0.6 * Math.sin(t * 23.1 + seed * 7.13) + 0.4 * Math.sin(t * 37.7 + seed * 3.71);
}

/** A number from 0 to 1000 that's stable for a clip, so random effects differ between clips. */
export function clipSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 1000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Overshoots a little before settling, for a "pop". */
function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}
