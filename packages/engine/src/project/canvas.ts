import type { Project } from "./model";
import { assetOf, mainTrack } from "./query";

export interface AspectPreset {
  id: string;
  label: string;
  /** Width and height ratio; null follows the first clip on the main track. */
  ratio: readonly [number, number] | null;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: "original", label: "Original", ratio: null },
  { id: "16:9", label: "16:9", ratio: [16, 9] },
  { id: "9:16", label: "9:16", ratio: [9, 16] },
  { id: "1:1", label: "1:1", ratio: [1, 1] },
  { id: "4:5", label: "4:5", ratio: [4, 5] },
  { id: "4:3", label: "4:3", ratio: [4, 3] },
  { id: "21:9", label: "21:9", ratio: [21, 9] },
];

/** Presets render with a 1080-pixel short edge. */
export const PRESET_SHORT_EDGE = 1080;
/** "Original" keeps the footage's size up to 4K. */
const ORIGINAL_MAX_SHORT_EDGE = 2160;

/** Canvas size for a ratio with the given short edge, in even numbers as H.264 requires. */
export function canvasSize(
  ratio: readonly [number, number],
  shortEdge: number = PRESET_SHORT_EDGE,
): { width: number; height: number } {
  const [w, h] = ratio;
  const scale = shortEdge / Math.min(w, h);
  return { width: even(w * scale), height: even(h * scale) };
}

/** Size of the first picture on the main track, if there is one. */
export function originalSize(project: Project): { width: number; height: number } | null {
  const first = mainTrack(project).clips[0];
  if (!first) return null;
  const asset = assetOf(project, first);
  const size = asset.video ?? asset.image;
  if (!size) return null;
  const shortEdge = Math.min(size.width, size.height);
  if (shortEdge <= ORIGINAL_MAX_SHORT_EDGE) return { width: even(size.width), height: even(size.height) };
  return canvasSize([size.width, size.height], ORIGINAL_MAX_SHORT_EDGE);
}

/** Which preset the canvas currently matches, so the picker can show it. */
export function currentAspect(project: Project): string {
  const { width, height } = project.canvas;
  const original = originalSize(project);
  if (original && original.width === width && original.height === height) return "original";
  const match = ASPECT_PRESETS.find(
    (preset) => preset.ratio && Math.abs(preset.ratio[0] / preset.ratio[1] - width / height) < 0.01,
  );
  return match?.id ?? "original";
}

export function setAspect(project: Project, presetId: string): Project {
  const preset = ASPECT_PRESETS.find((p) => p.id === presetId);
  if (!preset) return project;
  const size = preset.ratio ? canvasSize(preset.ratio) : originalSize(project);
  if (!size) return project;
  return { ...project, canvas: { ...project.canvas, ...size } };
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
