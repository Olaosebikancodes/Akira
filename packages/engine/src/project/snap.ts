import type { Micros } from "../time";
import type { Id, Project } from "./model";
import { clipEnd } from "./timing";

export interface Snap {
  time: Micros;
  /** The target it snapped to, for drawing a guide; null when it didn't snap. */
  target: Micros | null;
}

/** Pulls `time` onto the nearest target within `threshold`. */
export function snapTime(time: Micros, targets: readonly Micros[], threshold: Micros): Snap {
  let best: Micros | null = null;
  for (const target of targets) {
    const distance = Math.abs(target - time);
    if (distance <= threshold && (best === null || distance < Math.abs(best - time))) best = target;
  }
  return { time: best ?? time, target: best };
}

/**
 * Snaps a range being dragged so whichever edge is closer to a target lands
 * on it. Returns the snapped start; the length never changes.
 */
export function snapRange(
  start: Micros,
  length: Micros,
  targets: readonly Micros[],
  threshold: Micros,
): Snap {
  const head = snapTime(start, targets, threshold);
  const tail = snapTime(start + length, targets, threshold);
  const headDistance = head.target === null ? Infinity : Math.abs(head.target - start);
  const tailDistance = tail.target === null ? Infinity : Math.abs(tail.target - (start + length));
  if (headDistance === Infinity && tailDistance === Infinity) return { time: start, target: null };
  return headDistance <= tailDistance ? head : { time: tail.time - length, target: tail.target };
}

/** Everything worth snapping to: zero, the playhead, markers and clip edges (except the clips being dragged). */
export function snapTargets(
  project: Project,
  options: { playhead?: Micros; exclude?: ReadonlySet<Id> } = {},
): Micros[] {
  const targets = new Set<Micros>([0]);
  if (options.playhead !== undefined) targets.add(options.playhead);
  for (const marker of project.markers) targets.add(marker.time);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (options.exclude?.has(clip.id)) continue;
      targets.add(clip.start);
      targets.add(clipEnd(clip));
    }
  }
  return [...targets];
}
