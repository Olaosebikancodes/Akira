import type { Micros } from "../time";
import { type Asset, type Clip, type Id, type Project, TEXT_ASSET, TEXT_ASSET_ID, type Track } from "./model";
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

/** Whether the clip makes sound: a video or audio clip that isn't silenced or frozen. */
export function isAudible(project: Project, clip: Clip): boolean {
  return clip.volume > 0 && !isStill(project, clip) && assetOf(project, clip).audio !== undefined;
}
