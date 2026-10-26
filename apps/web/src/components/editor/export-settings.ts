import type { ExportFormat, FinishOptions, Micros, Project } from "@akira/engine";

export type Resolution = "720" | "1080" | "1440" | "2160";
export type QualityChoice = "smaller" | "balanced" | "best";

export interface ExportSettings {
  preset: "custom" | "tiktok";
  format: ExportFormat;
  resolution: Resolution;
  quality: QualityChoice;
}

export const DEFAULT_EXPORT: ExportSettings = { preset: "custom", format: "mp4", resolution: "1080", quality: "best" };

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

/**
 * TikTok's preset: 1080 wide, sharpened and lightly cleaned so its
 * re-compression has the best start, and a bitrate that keeps the file
 * under its upload limit however long the video runs.
 */
export function tiktokBitrate(duration: Micros): number {
  const seconds = Math.max(1, duration / 1_000_000);
  return Math.floor(Math.min(TIKTOK_MAX_BITRATE, (TIKTOK_SIZE_LIMIT * 8) / seconds - AUDIO_BITRATE));
}

export const TIKTOK_FINISH: FinishOptions = { denoise: 0.15, deband: 0.25, sharpen: 0.35 };

/** Rough file size for a fixed bitrate, video and audio together. */
export function estimatedSize(bitrate: number, duration: Micros): number {
  return ((bitrate + AUDIO_BITRATE) * (duration / 1_000_000)) / 8;
}

export const UPLOAD_TIPS: readonly string[] = [
  "In TikTok, turn on Settings → Upload HD (or High-quality uploads) before posting.",
  "Upload this file directly from your phone or computer. Sending it through WhatsApp or another app first shrinks it.",
  "Keep text and faces inside the safe zones, clear of TikTok's buttons and caption.",
  "TikTok re-compresses every upload and plays at 1080p at most. This file gives that step the cleanest start.",
];
