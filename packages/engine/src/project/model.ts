import type { FrameRate, Micros } from "../time";

export type Id = string;

/**
 * A project is plain, serialisable data. Rendering, playback and export all
 * read from it; nothing in it refers to decoders, textures or the DOM.
 */
export interface Project {
  id: Id;
  name: string;
  canvas: Canvas;
  assets: Record<Id, Asset>;
  /**
   * Video tracks draw bottom to top in array order. `tracks[0]` is always the
   * main track: a video track whose clips sit end to end with no gaps.
   */
  tracks: Track[];
  markers: Marker[];
}

export interface Canvas {
  width: number;
  height: number;
  frameRate: FrameRate;
  /** What shows wherever no clip covers the frame. */
  background: Background;
}

export type Background =
  | { kind: "color"; color: string }
  /** A blurred copy of the main track's frame, scaled to fill the canvas. */
  | { kind: "blur"; amount: number }
  | { kind: "image"; assetId: Id };

export interface Marker {
  id: Id;
  time: Micros;
}

export type AssetKind = "video" | "audio" | "image";

/** An imported media file and what we learned about it when probing. */
export interface Asset {
  id: Id;
  kind: AssetKind;
  name: string;
  /** Source time of the first frame or sample. Usually 0, but not always. */
  start: Micros;
  /**
   * Length of the source. Still images have none: they last as long as their
   * clip. Animated images give the length of one loop.
   */
  duration: Micros;
  video?: {
    /** Size as displayed, after the file's rotation is applied. */
    width: number;
    height: number;
    frameRate: FrameRate;
  };
  audio?: {
    sampleRate: number;
    channels: number;
  };
  image?: {
    width: number;
    height: number;
    animated: boolean;
  };
}

export type TrackKind = "video" | "audio";

export interface Track {
  id: Id;
  kind: TrackKind;
  clips: Clip[];
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface Clip {
  id: Id;
  assetId: Id;
  /** Where the clip begins on the timeline. */
  start: Micros;
  /**
   * First microsecond of the source that the clip uses. For stills and
   * freeze frames, which have no real source range, `sourceIn` is 0 and
   * `sourceOut` is simply the clip's length.
   */
  sourceIn: Micros;
  /** End of the used source range, exclusive. */
  sourceOut: Micros;
  /** Playback speed: 2 plays twice as fast and halves the clip's length. */
  speed: number;
  /** Loudness multiplier: 0 is silent, 1 is as recorded. */
  volume: number;
  transform: Transform;
  crop: Crop;
  /** Set on freeze frames: the source time shown for the clip's whole length. */
  freezeAt?: Micros;
}

/**
 * Where a visual clip sits on the canvas. Positions are relative to the
 * canvas size, so changing the aspect ratio keeps clips in proportion.
 */
export interface Transform {
  /** Offset of the clip's centre from the canvas centre, as a fraction of canvas width. */
  x: number;
  /** Offset of the clip's centre from the canvas centre, as a fraction of canvas height. */
  y: number;
  /** 1 fits the whole clip inside the canvas. */
  scale: number;
  /** Degrees clockwise. */
  rotation: number;
  /** 0 is invisible, 1 is opaque. */
  opacity: number;
  flipX: boolean;
  flipY: boolean;
}

/** Fractions of the source frame removed from each edge, 0 to 1. */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const IDENTITY_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  flipX: false,
  flipY: false,
};

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
