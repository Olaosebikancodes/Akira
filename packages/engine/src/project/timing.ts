import type { Micros } from "../time";
import type { Clip } from "./model";

/*
 * Every question about when a clip plays goes through these functions. Speed
 * curves and reverse only need to change the mapping here, not every caller.
 */

/** How long the clip occupies on the timeline. */
export function clipDuration(clip: Clip): Micros {
  return Math.round((clip.sourceOut - clip.sourceIn) / clip.speed);
}

/** Timeline time at which the clip stops playing, exclusive. */
export function clipEnd(clip: Clip): Micros {
  return clip.start + clipDuration(clip);
}

export function clipContains(clip: Clip, time: Micros): boolean {
  return time >= clip.start && time < clipEnd(clip);
}

/** Maps a timeline time to source time. Not clamped to the clip. */
export function toSourceTime(clip: Clip, time: Micros): Micros {
  return clip.sourceIn + Math.round((time - clip.start) * clip.speed);
}

/** Maps a source time to timeline time. Not clamped to the clip. */
export function toTimelineTime(clip: Clip, sourceTime: Micros): Micros {
  return clip.start + Math.round((sourceTime - clip.sourceIn) / clip.speed);
}

/**
 * The source time to show when the playhead is at `time`. Clamped to the
 * clip's source range so callers never ask a decoder for a frame outside it.
 */
export function sourceTimeAt(clip: Clip, time: Micros): Micros {
  return Math.min(
    Math.max(toSourceTime(clip, time), clip.sourceIn),
    clip.sourceOut - 1,
  );
}
