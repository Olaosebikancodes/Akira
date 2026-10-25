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

/**
 * The source time to show when the playhead is at `time`. Clamped to the
 * clip's source range so callers never ask a decoder for a frame outside it.
 */
export function sourceTimeAt(clip: Clip, time: Micros): Micros {
  const offset = Math.round((time - clip.start) * clip.speed);
  return Math.min(
    Math.max(clip.sourceIn + offset, clip.sourceIn),
    clip.sourceOut - 1,
  );
}
