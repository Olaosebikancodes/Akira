import {
  chooseVideoCodec,
  type ExportFormat,
  type FinishOptions,
  frameRateToNumber,
  type Micros,
  type Project,
  type VideoCodec,
} from "@akira/engine";

export type Resolution = "720" | "1080" | "1440" | "2160";
export type QualityChoice = "smaller" | "balanced" | "best";
/** TikTok's usual 1080p, or the biggest file it accepts. */
export type TikTokSize = "1080" | "max";
/** The project's own size, or upscaled to 4K or 8K. */
export type MasterSize = "original" | "2160" | "4320";

export interface ExportSettings {
  preset: "custom" | "tiktok" | "master";
  format: ExportFormat;
  resolution: Resolution;
  quality: QualityChoice;
  tiktokSize: TikTokSize;
  masterSize: MasterSize;
}

export const DEFAULT_EXPORT: ExportSettings = {
  preset: "custom",
  format: "mp4",
  resolution: "1080",
  quality: "best",
  tiktokSize: "1080",
  masterSize: "original",
};

export const RESOLUTIONS: readonly { value: Resolution; label: string }[] = [
  { value: "720", label: "720p" },
  { value: "1080", label: "1080p" },
  { value: "1440", label: "1440p" },
  { value: "2160", label: "4K" },
];

/** TikTok caps uploads from iPhones at about 287 MB; this leaves a little room. */
const TIKTOK_SIZE_LIMIT = 270 * 1_000_000;
/** Plenty for 1080p; more just gets thrown away by TikTok's own encoder. */
const TIKTOK_MAX_BITRATE = 20_000_000;
/** The same care at 4K, which has four times the pixels. */
const TIKTOK_MAX_BITRATE_4K = 50_000_000;
/** Audio's share of the size budget, at about 192 kb/s. */
const AUDIO_BITRATE = 192_000;

/**
 * The frame size for a resolution: its number is the short side, and the
 * long side follows the project's shape. Both are kept even, as H.264 needs.
 */
export function exportSize(project: Project, shortSide: number): { width: number; height: number } {
  const { width, height } = project.canvas;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return width >= height
    ? { width: even((shortSide * width) / height), height: shortSide }
    : { width: shortSide, height: even((shortSide * height) / width) };
}

/** Whether the project is vertical 9:16, the shape TikTok, Reels and Shorts fill the screen with. */
export function isVertical(project: Project): boolean {
  return Math.abs(project.canvas.width / project.canvas.height - 9 / 16) < 0.01;
}

/** The project's frame rate as a number, for showing: 30, 59.94. */
export function framesPerSecond(project: Project): number {
  return Number(frameRateToNumber(project.canvas.frameRate).toFixed(2));
}

/**
 * The short side of a TikTok export. TikTok takes files up to 4096 pixels a
 * side, so 2160 × 3840 is the biggest standard size it accepts.
 */
export function tiktokShortSide(size: TikTokSize): number {
  return size === "max" ? 2160 : 1080;
}

/**
 * TikTok's preset: sharpened and lightly cleaned so its re-compression has
 * the best start, at a bitrate that keeps the file under its upload limit
 * however long the video runs.
 */
export function tiktokBitrate(duration: Micros, size: TikTokSize = "1080"): number {
  const seconds = Math.max(1, duration / 1_000_000);
  const ceiling = size === "max" ? TIKTOK_MAX_BITRATE_4K : TIKTOK_MAX_BITRATE;
  return Math.floor(Math.min(ceiling, (TIKTOK_SIZE_LIMIT * 8) / seconds - AUDIO_BITRATE));
}

export const TIKTOK_FINISH: FinishOptions = { denoise: 0.15, deband: 0.25, sharpen: 0.35 };

/** Rough file size for a fixed bitrate, video and audio together. */
export function estimatedSize(bitrate: number, duration: Micros): number {
  return ((bitrate + AUDIO_BITRATE) * (duration / 1_000_000)) / 8;
}

/** A file size the way people read them, kept on one line: 840 MB, 3.2 GB. */
export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

export const UPLOAD_TIPS: readonly string[] = [
  "In TikTok, turn on Settings → Upload HD (or High-quality uploads) before posting.",
  "Upload this file directly from your phone or computer. Sending it through WhatsApp or another app first shrinks it.",
  "Keep text and faces inside the safe zones, clear of TikTok's buttons and caption.",
  "TikTok re-compresses every upload, and most viewers get 1080p. This file gives that step the cleanest start.",
];

/**
 * Codecs for a master, in the order they're tried. H.264 plays everywhere
 * and most graphics chips encode it, but rarely beyond 4K; HEVC and AV1 take
 * over at sizes it can't reach. VP9 isn't tried: Chrome takes minutes just to
 * say whether it can encode 8K VP9, and it would be slower still to do it.
 */
export const MASTER_CODECS = ["avc", "hevc", "av1"] as const satisfies readonly VideoCodec[];

export type MasterCodec = (typeof MASTER_CODECS)[number];

export const CODEC_NAMES: Record<MasterCodec, string> = { avc: "H.264", hevc: "HEVC", av1: "AV1" };

/**
 * Bits per pixel per frame for a master: enough that fine detail and grain
 * survive. Newer codecs keep the same picture in fewer bits.
 */
const MASTER_BITS_PER_PIXEL: Record<MasterCodec, number> = { avc: 0.3, hevc: 0.2, av1: 0.2 };
/** Encoders turn down much more than this, whatever the size. */
const MASTER_MAX_BITRATE = 200_000_000;

/** A master's bitrate: 75 Mb/s for 4K at 30 fps in H.264, up to 200 Mb/s for 8K. */
export function masterBitrate(width: number, height: number, frameRate: number, codec: MasterCodec): number {
  return Math.round(Math.min(MASTER_MAX_BITRATE, width * height * frameRate * MASTER_BITS_PER_PIXEL[codec]));
}

const MASTER_SIZES: readonly { value: MasterSize; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "2160", label: "4K" },
  { value: "4320", label: "8K" },
];

/** The master sizes worth offering: the project's own, and the upscales actually bigger than it. */
export function masterSizes(project: Project): readonly { value: MasterSize; label: string }[] {
  const shortSide = Math.min(project.canvas.width, project.canvas.height);
  return MASTER_SIZES.filter((size) => size.value === "original" || Number(size.value) > shortSide);
}

/** The chosen master size, or the original when the project has since outgrown it. */
export function masterSizeFor(project: Project, size: MasterSize): MasterSize {
  return masterSizes(project).some((option) => option.value === size) ? size : "original";
}

export interface MasterPlan {
  width: number;
  height: number;
  codec: MasterCodec;
  /** Whether the graphics chip encodes it; software encoding at 4K and up is slow. */
  hardware: boolean;
  bitrate: number;
  /** Upscaled past the project's own size, with FSR wherever footage is smaller. */
  upscale: boolean;
}

/** A master's frame size: the project's own, or upscaled to a 4K or 8K short side. */
export function masterDimensions(project: Project, size: MasterSize): { width: number; height: number } {
  const chosen = masterSizeFor(project, size);
  return exportSize(project, chosen === "original" ? Math.min(project.canvas.width, project.canvas.height) : Number(chosen));
}

/** What a master export of the project would be, or null when this browser can't encode one that big. */
export async function planMaster(project: Project, size: MasterSize): Promise<MasterPlan | null> {
  const chosen = masterSizeFor(project, size);
  const { width, height } = masterDimensions(project, chosen);
  const frameRate = frameRateToNumber(project.canvas.frameRate);
  const bitrate = (codec: MasterCodec) => masterBitrate(width, height, frameRate, codec);
  const choice = await chooseVideoCodec(MASTER_CODECS, { width, height, frameRate, bitrate });
  return choice && { width, height, ...choice, bitrate: bitrate(choice.codec), upscale: chosen !== "original" };
}
