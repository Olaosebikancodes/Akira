import type { Clip } from "../project/model";
import { clipDuration, clipEnd } from "../project/timing";
import type { Micros } from "../time";

export interface GainPoint {
  /** Timeline time. */
  time: Micros;
  gain: number;
}

/** The clip's loudness at a timeline time: its volume, scaled down over its fades. */
export function clipGainAt(clip: Clip, time: Micros): number {
  const length = clipDuration(clip);
  const into = Math.min(Math.max(time - clip.start, 0), length);
  let gain = clip.volume;
  if (clip.fadeIn > 0 && into < clip.fadeIn) gain *= into / clip.fadeIn;
  if (clip.fadeOut > 0 && into > length - clip.fadeOut) gain *= (length - into) / clip.fadeOut;
  return gain;
}

/**
 * The corners of the clip's volume envelope from timeline time `from` to
 * its end. Joined by straight ramps they give the fades exactly, so they map
 * straight onto Web Audio's linearRampToValueAtTime. Playback that starts
 * mid-fade begins at the right level.
 */
export function gainEnvelope(clip: Clip, from: Micros): GainPoint[] {
  const end = clipEnd(clip);
  const start = Math.max(from, clip.start);
  if (start >= end) return [];
  const corners = [start, clip.start + clip.fadeIn, end - clip.fadeOut, end].filter(
    (time) => time >= start && time <= end,
  );
  const times = [...new Set(corners)].sort((a, b) => a - b);
  return times.map((time) => ({ time, gain: clipGainAt(clip, time) }));
}
