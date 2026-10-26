import type { Id, Micros, Project, Track } from "@akira/engine";

export const HEADER_WIDTH = 164;
/** On phones the track header keeps one toggle and no name. */
export const COMPACT_HEADER_WIDTH = 40;
export const RULER_HEIGHT = 28;
/** Breathing room after the last clip, so there's always somewhere to drop. */
export const TAIL_SECONDS = 30;
/** How close, in pixels, an edge must come to a target before it snaps. */
export const SNAP_PIXELS = 8;

export interface Row {
  track: Track;
  /** Position in `project.tracks`. */
  index: number;
  height: number;
  isMain: boolean;
}

/**
 * Tracks in display order, top to bottom: overlays (topmost first), the main
 * track, then audio. Overlays are listed in reverse because later video
 * tracks draw on top.
 */
export function timelineRows(project: Project): Row[] {
  const rows = project.tracks.map((track, index) => ({
    track,
    index,
    isMain: index === 0,
    height: index === 0 ? 64 : track.kind === "video" ? 52 : 40,
  }));
  const overlays = rows.filter((row) => row.track.kind === "video" && !row.isMain).reverse();
  const audio = rows.filter((row) => row.track.kind === "audio");
  return [...overlays, rows[0]!, ...audio];
}

export function timeToX(time: Micros, zoom: number): number {
  return (time / 1_000_000) * zoom;
}

export function xToTime(x: number, zoom: number): Micros {
  return Math.round((x / zoom) * 1_000_000);
}

/** Where a pointer lands vertically: a track, or empty space above or below all tracks. */
export type RowTarget = { kind: "track"; trackId: Id } | { kind: "above" } | { kind: "below" };

export interface RowBox {
  trackId: Id;
  top: number;
  bottom: number;
}

export function rowAt(boxes: readonly RowBox[], y: number): RowTarget {
  const first = boxes[0];
  const last = boxes.at(-1);
  if (!first || !last) return { kind: "below" };
  if (y < first.top) return { kind: "above" };
  if (y >= last.bottom) return { kind: "below" };
  const hit = boxes.find((box) => y >= box.top && y < box.bottom);
  return hit ? { kind: "track", trackId: hit.trackId } : { kind: "below" };
}

/**
 * Ruler tick spacing for a zoom level: the smallest step from a list of
 * natural intervals that keeps labels at least ~90 pixels apart.
 */
export function rulerStep(zoom: number, frameDuration: Micros): { major: Micros; minor: Micros } {
  const candidates = [
    frameDuration,
    frameDuration * 5,
    frameDuration * 10,
    500_000,
    1_000_000,
    2_000_000,
    5_000_000,
    10_000_000,
    15_000_000,
    30_000_000,
    60_000_000,
    120_000_000,
    300_000_000,
    600_000_000,
  ];
  const major = candidates.find((step) => timeToX(step, zoom) >= 90) ?? candidates.at(-1)!;
  return { major, minor: major === frameDuration ? major : major / 5 };
}
