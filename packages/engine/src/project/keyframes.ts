import type { Micros } from "../time";
import type { Clip, Easing, Keyframe, KeyframeProperty, Transform } from "./model";
import { toSourceTime, toTimelineTime } from "./timing";

export const KEYFRAME_PROPERTIES: readonly KeyframeProperty[] = ["x", "y", "scale", "rotation", "opacity", "volume"];

/** Maps 0-1 progress between two keyframes to how far the value has moved. */
export function ease(easing: Easing, t: number): number {
  switch (easing) {
    case "linear":
      return t;
    case "ease-in":
      return t * t * t;
    case "ease-out":
      return 1 - (1 - t) ** 3;
    case "ease-in-out":
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case "hold":
      return 0;
  }
}

/** The value at source time `at`: held at the first value before it, and at the last after. */
export function interpolate(keyframes: readonly Keyframe[], at: Micros): number {
  const first = keyframes[0]!;
  if (at <= first.time) return first.value;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const from = keyframes[i]!;
    const to = keyframes[i + 1]!;
    if (at < to.time) {
      const t = (at - from.time) / (to.time - from.time);
      return from.value + (to.value - from.value) * ease(from.easing, t);
    }
  }
  return keyframes[keyframes.length - 1]!.value;
}

/** Where a timeline time falls on the clip's keyframe clock. */
export function keyframeClock(clip: Clip, time: Micros): Micros {
  return toSourceTime(clip, time);
}

/** Where a keyframe sits on the timeline. */
export function keyframeTimelineTime(clip: Clip, keyframe: Keyframe): Micros {
  return toTimelineTime(clip, keyframe.time);
}

/** The clip's own value for a property, used when it has no keyframes. */
export function baseValue(clip: Clip, property: KeyframeProperty): number {
  return property === "volume" ? clip.volume : clip.transform[property];
}

export function isKeyframed(clip: Clip, property: KeyframeProperty): boolean {
  return (clip.keyframes?.[property]?.length ?? 0) > 0;
}

/** A property's value at a timeline time, keyframed or not. */
export function propertyAt(clip: Clip, property: KeyframeProperty, time: Micros): number {
  const keyframes = clip.keyframes?.[property];
  return keyframes?.length ? interpolate(keyframes, keyframeClock(clip, time)) : baseValue(clip, property);
}

/** The clip's transform at a timeline time, before in, out and loop animations. */
export function transformAt(clip: Clip, time: Micros): Transform {
  if (!clip.keyframes) return clip.transform;
  return {
    ...clip.transform,
    x: propertyAt(clip, "x", time),
    y: propertyAt(clip, "y", time),
    scale: propertyAt(clip, "scale", time),
    rotation: propertyAt(clip, "rotation", time),
    opacity: propertyAt(clip, "opacity", time),
  };
}

export function volumeAt(clip: Clip, time: Micros): number {
  return propertyAt(clip, "volume", time);
}

/** Whether the clip is silent all the way through. */
export function isSilent(clip: Clip): boolean {
  const keyframes = clip.keyframes?.volume;
  return keyframes?.length ? keyframes.every((k) => k.value === 0) : clip.volume === 0;
}

/** The clip without keyframes for the given properties. */
export function withoutKeyframes(clip: Clip, properties: readonly KeyframeProperty[]): Clip {
  if (!clip.keyframes) return clip;
  const kept = Object.entries(clip.keyframes).filter(([property]) => !properties.includes(property as KeyframeProperty));
  return { ...clip, keyframes: kept.length > 0 ? Object.fromEntries(kept) : undefined };
}

/** Moves every keyframe by `by`, for stills whose clock restarts when they're split or trimmed. */
export function shiftKeyframes(clip: Clip, by: Micros): Clip {
  if (!clip.keyframes || by === 0) return clip;
  const keyframes = Object.fromEntries(
    Object.entries(clip.keyframes).map(([property, list]) => [property, list.map((k) => ({ ...k, time: k.time + by }))]),
  );
  return { ...clip, keyframes };
}
