import type { Micros } from "../time";
import type { Asset, Canvas, Clip, Id, Project, Track, TrackKind } from "./model";
import { clipContains, clipEnd } from "./timing";

export function createId(): Id {
  return crypto.randomUUID();
}

export function createProject(name: string, canvas: Canvas): Project {
  return {
    id: createId(),
    name,
    canvas,
    assets: {},
    tracks: [createTrack("video")],
  };
}

export function createTrack(kind: TrackKind): Track {
  return {
    id: createId(),
    kind,
    clips: [],
    muted: false,
    hidden: false,
    locked: false,
  };
}

/** A clip that uses the whole asset at normal speed. */
export function createClip(asset: Asset, start: Micros): Clip {
  return {
    id: createId(),
    assetId: asset.id,
    start,
    sourceIn: asset.start,
    sourceOut: asset.start + asset.duration,
    speed: 1,
  };
}

/** Where the last clip on any track ends. */
export function projectDuration(project: Project): Micros {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  }
  return end;
}

export function clipAt(track: Track, time: Micros): Clip | undefined {
  return track.clips.find((clip) => clipContains(clip, time));
}

export function findClip(project: Project, clipId: Id): Clip | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}
