import type { Micros } from "../time";
import {
  type Asset,
  type Canvas,
  type Clip,
  type ClipText,
  TEXT_ASSET_ID,
  type Transform,
  IDENTITY_TRANSFORM,
  type Id,
  NO_AUDIO_FILTERS,
  NO_CROP,
  type Project,
  type Track,
  type TrackKind,
} from "./model";

/** How long a still image lasts when it's first added. */
export const DEFAULT_STILL_DURATION: Micros = 5_000_000;
/** How long new text lasts: long enough to read a short line. */
export const DEFAULT_TEXT_DURATION: Micros = 3_000_000;

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
    markers: [],
  };
}

export function createTrack(kind: TrackKind): Track {
  return {
    id: createId(),
    kind,
    clips: [],
    muted: false,
    solo: false,
    hidden: false,
    locked: false,
  };
}

/** A clip that uses the whole asset at normal speed, or a still's default length. */
export function createClip(asset: Asset, start: Micros): Clip {
  const still = asset.kind === "image";
  return {
    id: createId(),
    assetId: asset.id,
    start,
    sourceIn: still ? 0 : asset.start,
    sourceOut: still ? DEFAULT_STILL_DURATION : asset.start + asset.duration,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    audioFilters: NO_AUDIO_FILTERS,
    transform: IDENTITY_TRANSFORM,
    crop: NO_CROP,
  };
}

/** A text clip. Like a still, its length is free and it has no source range. */
export function createTextClip(
  start: Micros,
  text: ClipText,
  duration: Micros = DEFAULT_TEXT_DURATION,
  position: Partial<Transform> = {},
): Clip {
  return {
    id: createId(),
    assetId: TEXT_ASSET_ID,
    start,
    sourceIn: 0,
    sourceOut: duration,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    audioFilters: NO_AUDIO_FILTERS,
    transform: { ...IDENTITY_TRANSFORM, ...position },
    crop: NO_CROP,
    text,
  };
}
