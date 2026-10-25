import { keyframeTimelineTime, volumeAt } from "../project/keyframes";
import type { Clip } from "../project/model";
import { clipDuration, clipEnd } from "../project/timing";
import type { Micros } from "../time";

export interface GainPoint {
  /** Timeline time. */
  time: Micros;
  gain: number;
}

/** Keyframed volume is followed in straight steps this long, which the ear hears as smooth. */
const CURVE_STEP: Micros = 20_000;

/** The clip's loudness at a timeline time: its volume (keyframed or not), scaled down over its fades. */
export function clipGainAt(clip: Clip, time: Micros): number {
  const length = clipDuration(clip);
  const into = Math.min(Math.max(time - clip.start, 0), length);
  let gain = volumeAt(clip, clip.start + into);
  if (clip.fadeIn > 0 && into < clip.fadeIn) gain *= into / clip.fadeIn;
  if (clip.fadeOut > 0 && into > length - clip.fadeOut) gain *= (length - into) / clip.fadeOut;
  return gain;
}

/**
 * The corners of the clip's volume envelope from timeline time `from` to
 * its end. Joined by straight ramps they give the fades exactly, so they map
 * straight onto Web Audio's linearRampToValueAtTime; keyframed volume adds
 * enough points to follow its curves. Playback that starts mid-fade begins
 * at the right level.
 */
export function gainEnvelope(clip: Clip, from: Micros): GainPoint[] {
  const end = clipEnd(clip);
  const start = Math.max(from, clip.start);
  if (start >= end) return [];
  const corners = [start, clip.start + clip.fadeIn, end - clip.fadeOut, end, ...volumeCorners(clip)].filter(
    (time) => time >= start && time <= end,
  );
  const times = [...new Set(corners)].sort((a, b) => a - b);
  return times.map((time) => ({ time, gain: clipGainAt(clip, time) }));
}

/** Where keyframed volume changes course on the timeline, plus points in between to follow its curves. */
function volumeCorners(clip: Clip): Micros[] {
  const keyframes = clip.keyframes?.volume;
  if (!keyframes?.length) return [];
  const times: Micros[] = [];
  keyframes.forEach((keyframe, i) => {
    const at = keyframeTimelineTime(clip, keyframe);
    times.push(at);
    const next = keyframes[i + 1];
    if (!next) return;
    const nextAt = keyframeTimelineTime(clip, next);
    // A hold keeps its level until just before the next keyframe, then jumps.
    if (keyframe.easing === "hold") times.push(nextAt - 1);
    else for (let t = at + CURVE_STEP; t < nextAt; t += CURVE_STEP) times.push(t);
  });
  return times;
}
