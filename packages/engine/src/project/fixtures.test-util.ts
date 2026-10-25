import { FPS_30 } from "../time";
import { createClip, createProject } from "./create";
import type { Asset, Clip, Project } from "./model";
import { clipEnd } from "./timing";

export const VIDEO: Asset = {
  id: "video",
  kind: "video",
  name: "video.mp4",
  start: 0,
  duration: 10_000_000,
  video: { width: 1920, height: 1080, frameRate: FPS_30 },
  audio: { sampleRate: 48_000, channels: 2 },
};

export const IMAGE: Asset = {
  id: "image",
  kind: "image",
  name: "image.png",
  start: 0,
  duration: 0,
  image: { width: 800, height: 800, animated: false },
};

export const AUDIO: Asset = {
  id: "audio",
  kind: "audio",
  name: "audio.mp3",
  start: 0,
  duration: 8_000_000,
  audio: { sampleRate: 44_100, channels: 2 },
};

export function emptyProject(): Project {
  const project = createProject("Test", {
    width: 1920,
    height: 1080,
    frameRate: FPS_30,
    background: { kind: "color", color: "#000000" },
  });
  return { ...project, assets: { video: VIDEO, image: IMAGE, audio: AUDIO } };
}

/** A clip with a readable id, using `length` microseconds of the asset from `sourceIn`. */
export function clip(id: string, asset: Asset, start: number, length?: number, sourceIn = 0): Clip {
  const base = createClip(asset, start);
  if (length === undefined) return { ...base, id };
  if (asset.kind === "image") return { ...base, id, sourceIn: 0, sourceOut: length };
  return { ...base, id, sourceIn, sourceOut: sourceIn + length };
}

/** Builds a project from tracks of clips; the first track is the main track. */
export function projectWith(...tracks: { kind?: "video" | "audio"; clips: Clip[]; locked?: boolean }[]): Project {
  const project = emptyProject();
  return {
    ...project,
    tracks: tracks.map((track, index) => ({
      id: index === 0 ? "main" : `track${index}`,
      kind: track.kind ?? "video",
      clips: track.clips,
      muted: false,
      solo: false,
      hidden: false,
      locked: track.locked ?? false,
    })),
  };
}

/** Compact view of a track for assertions: [id, start, end]. */
export function layout(project: Project, trackIndex: number): [string, number, number][] {
  return (project.tracks[trackIndex]?.clips ?? []).map((c) => [c.id, c.start, clipEnd(c)]);
}
