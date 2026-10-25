import type { Clip } from "../project/model";
import { toSourceTime, toTimelineTime } from "../project/timing";
import type { Micros } from "../time";

/**
 * Where part of a decoded audio buffer plays on the timeline. Offset and
 * duration are in source time, which is what `AudioBufferSourceNode.start()`
 * expects even when the node's playback rate isn't 1.
 */
export interface AudioPlacement {
  /** Timeline time at which the first audible sample plays. */
  at: Micros;
  /** How far into the buffer playback starts. */
  offset: Micros;
  /** How much of the buffer plays. */
  duration: Micros;
}

/**
 * Trims a decoded buffer to the clip's source range and to playback that
 * starts at timeline time `from`. Returns null when nothing of it is heard.
 */
export function placeAudioBuffer(
  clip: Clip,
  bufferStart: Micros,
  bufferDuration: Micros,
  from: Micros,
): AudioPlacement | null {
  const playFrom = Math.max(bufferStart, clip.sourceIn, toSourceTime(clip, from));
  const playTo = Math.min(bufferStart + bufferDuration, clip.sourceOut);
  if (playTo <= playFrom) return null;
  return {
    at: toTimelineTime(clip, playFrom),
    offset: playFrom - bufferStart,
    duration: playTo - playFrom,
  };
}
