import type { Micros } from "../time";
import { type Asset, type Clip, type Id, type Project, TEXT_ASSET, TEXT_ASSET_ID, type Track } from "./model";
import { isSilent } from "./keyframes";
import { clipContains, clipEnd } from "./timing";

/** Where the last clip on any track ends. */
export function projectDuration(project: Project): Micros {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  }
  return end;
}

export function mainTrack(project: Project): Track {
  return project.tracks[0]!;
}

export function clipAt(track: Track, time: Micros): Clip | undefined {
  return track.clips.find((clip) => clipContains(clip, time));
}

/** The clip that starts exactly where this one ends on the same track, if any. */
export function followingClip(track: Track, clip: Clip): Clip | undefined {
  const end = clipEnd(clip);
  return track.clips.find((other) => other.id !== clip.id && other.start === end);
}

export interface ActiveTransition {
  from: Clip;
  to: Clip;
  /** Which transition, by catalogue name. */
  kind: string;
  /** 0 to 1 across the transition. */
  progress: number;
}

/**
 * The transition playing on a track at `time`, if any. Transitions are
 * centred on the cut, so the outgoing clip holds its last frame for the
 * second half and the incoming clip holds its first frame for the first.
 */
export function transitionAt(track: Track, time: Micros): ActiveTransition | undefined {
  for (const from of track.clips) {
    if (!from.transition) continue;
    const cut = clipEnd(from);
    const { duration, kind } = from.transition;
    const begin = cut - duration / 2;
    if (time < begin || time >= begin + duration) continue;
    const to = followingClip(track, from);
    if (to) return { from, to, kind, progress: (time - begin) / duration };
  }
  return undefined;
}

export interface ClipLocation {
  clip: Clip;
  track: Track;
  /** Position of the track in `project.tracks`. */
  trackIndex: number;
}

export function locateClip(project: Project, clipId: Id): ClipLocation | undefined {
  for (const [trackIndex, track] of project.tracks.entries()) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track, trackIndex };
  }
  return undefined;
}

export function findClip(project: Project, clipId: Id): Clip | undefined {
  return locateClip(project, clipId)?.clip;
}

export function assetOf(project: Project, clip: Clip): Asset {
  if (clip.assetId === TEXT_ASSET_ID) return TEXT_ASSET;
  const asset = project.assets[clip.assetId];
  if (!asset) throw new Error(`Clip ${clip.id} refers to a missing asset.`);
  return asset;
}

/**
 * Stills, text and freeze frames show one picture, so they have no source
 * limits: they can be trimmed to any length but can't change speed.
 */
export function isStill(project: Project, clip: Clip): boolean {
  const kind = assetOf(project, clip).kind;
  return clip.freezeAt !== undefined || kind === "image" || kind === "text";
}

/** Whether the clip's asset has camera motion measured over all the footage the clip shows. */
export function motionCovers(project: Project, clip: Clip): boolean {
  const motion = assetOf(project, clip).motion;
  return !!motion && motion.start <= clip.sourceIn && motion.end >= clip.sourceOut;
}

/** Whether the clip plays its media backwards. */
export function isReversed(project: Project, clip: Clip): boolean {
  return assetOf(project, clip).reverseOf !== undefined;
}

/** A reversed copy of the clip's media that already covers its range, if one was made before. */
export function reversedCopyFor(project: Project, clip: Clip): Asset | undefined {
  return Object.values(project.assets).find(
    ({ reverseOf }) => reverseOf?.assetId === clip.assetId && reverseOf.start <= clip.sourceIn && reverseOf.end >= clip.sourceOut,
  );
}

/** Whether the clip makes sound: a video or audio clip that isn't silenced or frozen. */
export function isAudible(project: Project, clip: Clip): boolean {
  return !isSilent(clip) && !isStill(project, clip) && assetOf(project, clip).audio !== undefined;
}
