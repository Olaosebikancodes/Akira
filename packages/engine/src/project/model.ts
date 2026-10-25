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

/** Text clips have no file; they all refer to the built-in text asset. */
export type AssetKind = "video" | "audio" | "image" | "font" | "text";

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
  /** Set on imported font files: the family name text clips use to pick it. */
  font?: {
    family: string;
  };
}

export const TEXT_ASSET_ID = "text";

/** The asset every text clip refers to. It isn't stored in projects or shown with media. */
export const TEXT_ASSET: Asset = { id: TEXT_ASSET_ID, kind: "text", name: "Text", start: 0, duration: 0 };

export type TrackKind = "video" | "audio";

export interface Track {
  id: Id;
  kind: TrackKind;
  clips: Clip[];
  muted: boolean;
  /** When any track is soloed, only soloed tracks are heard. */
  solo: boolean;
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
  /** How long the sound takes to rise from silence at the start. */
  fadeIn: Micros;
  /** How long the sound takes to fall to silence at the end. */
  fadeOut: Micros;
  audioFilters: AudioFilters;
  transform: Transform;
  crop: Crop;
  /** Set on freeze frames: the source time shown for the clip's whole length. */
  freezeAt?: Micros;
  /** Set on text clips: what they say and how it looks. */
  text?: ClipText;
  /** How the clip enters, leaves and moves while on screen. */
  animation?: ClipAnimation;
}

export interface ClipText {
  content: string;
  style: TextStyle;
}

/** Sizes are fractions of the font size, which is itself a fraction of the canvas's short edge. */
export interface TextStyle {
  /** A built-in font or an imported font's family. */
  font: string;
  /** Font size as a fraction of the canvas's short edge, so text looks the same at any aspect ratio. */
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  letterSpacing: number;
  /** Distance between lines as a multiple of the font size. */
  lineHeight: number;
  stroke: { color: string; width: number } | null;
  shadow: { color: string; blur: number; offsetX: number; offsetY: number } | null;
  background: { color: string; opacity: number; padding: number; radius: number } | null;
}

export type InAnimation = "fade" | "pop" | "slide-up" | "slide-left" | "typewriter";
export type OutAnimation = "fade" | "pop" | "slide-down";
export type LoopAnimation = "pulse" | "bounce";

export interface ClipAnimation {
  in: { kind: InAnimation; duration: Micros } | null;
  out: { kind: OutAnimation; duration: Micros } | null;
  /** `period` is one full cycle of the movement. */
  loop: { kind: LoopAnimation; period: Micros } | null;
}

export const NO_ANIMATION: ClipAnimation = { in: null, out: null, loop: null };

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: "Inter",
  size: 0.08,
  bold: true,
  italic: false,
  color: "#ffffff",
  align: "center",
  letterSpacing: 0,
  lineHeight: 1.15,
  stroke: null,
  shadow: { color: "#000000", blur: 0.12, offsetX: 0, offsetY: 0.04 },
  background: null,
};

/** Captions sit low on the frame in a soft dark box, readable over any footage. */
export const CAPTION_STYLE: TextStyle = {
  ...DEFAULT_TEXT_STYLE,
  size: 0.045,
  shadow: null,
  background: { color: "#000000", opacity: 0.6, padding: 0.3, radius: 0.18 },
};

/** Where captions sit: centred, a little above the bottom edge. */
export const CAPTION_POSITION = { x: 0, y: 0.36 };

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

/** Classic clean-up filters for a clip's sound. None of them is AI. */
export interface AudioFilters {
  /** Hiss reduction strength, 0 (off) to 1. */
  denoise: number;
  /** Mains hum to notch out: 50 Hz (Nigeria, Europe), 60 Hz (the Americas) or none. */
  hum: 0 | 50 | 60;
  /** Cut low rumble from wind, traffic and handling below about 80 Hz. */
  rumble: boolean;
}

export const NO_AUDIO_FILTERS: AudioFilters = { denoise: 0, hum: 0, rumble: false };

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
