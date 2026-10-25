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
  /** Bottom to top: `tracks[0]` is the main track, later tracks draw over it. */
  tracks: Track[];
}

export interface Canvas {
  width: number;
  height: number;
  frameRate: FrameRate;
  /** `#rrggbb` colour shown wherever no clip covers the frame. */
  background: string;
}

export type AssetKind = "video" | "audio" | "image";

/** An imported media file and what we learned about it when probing. */
export interface Asset {
  id: Id;
  kind: AssetKind;
  name: string;
  /** Source time of the first frame or sample. Usually 0, but not always. */
  start: Micros;
  /** Zero for still images, which last as long as their clip. */
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
  /** First microsecond of the source that the clip uses. */
  sourceIn: Micros;
  /** End of the used source range, exclusive. */
  sourceOut: Micros;
  /** Playback speed: 2 plays twice as fast and halves the clip's length. */
  speed: number;
}
