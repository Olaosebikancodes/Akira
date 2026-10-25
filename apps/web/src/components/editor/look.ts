"use client";

import {
  type Adjustments,
  analyzeColor,
  assetOf,
  clipEnd,
  type EffectKind,
  findClip,
  followingClip,
  type Id,
  locateClip,
  mainTrack,
  type Micros,
  NEUTRAL_ADJUSTMENTS,
  setTransition,
  toSourceTime,
  updateClipLook,
} from "@akira/engine";
import { targetClipIds } from "./actions";
import { commit, notify, select, useEditor } from "./store";

const get = useEditor.getState;

export const DEFAULT_TRANSITION_DURATION: Micros = 500_000;

/** "CircleOpen" becomes "Circle open", matching the catalogue's own labels. */
export function transitionLabel(kind: string): string {
  const [first, ...rest] = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return [first, ...rest.map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()))].join(" ");
}

export const EFFECTS: readonly { kind: EffectKind; label: string; description: string }[] = [
  { kind: "blur", label: "Blur", description: "Soft focus" },
  { kind: "shake", label: "Shake", description: "Handheld jitter" },
  { kind: "glitch", label: "Glitch", description: "Digital tearing" },
  { kind: "vhs", label: "VHS", description: "Old tape look" },
  { kind: "grain", label: "Film grain", description: "Moving grain" },
  { kind: "flash", label: "Flash", description: "Pulsing light" },
];

export function effectLabel(kind: EffectKind): string {
  return EFFECTS.find((effect) => effect.kind === kind)?.label ?? kind;
}

/** Built-in looks: each is a set of adjustments, so they stay editable afterwards. */
export const FILTERS: readonly { id: string; label: string; adjust: Partial<Adjustments> }[] = [
  { id: "vivid", label: "Vivid", adjust: { saturation: 0.35, contrast: 0.15 } },
  { id: "warm", label: "Warm", adjust: { temperature: 0.35, saturation: 0.1 } },
  { id: "cool", label: "Cool", adjust: { temperature: -0.35, tint: -0.05 } },
  { id: "golden", label: "Golden hour", adjust: { temperature: 0.5, exposure: 0.08, highlights: -0.15, saturation: 0.15 } },
  { id: "faded", label: "Faded", adjust: { contrast: -0.25, saturation: -0.2, shadows: 0.25 } },
  { id: "moody", label: "Moody", adjust: { temperature: -0.15, contrast: 0.2, saturation: -0.2, shadows: -0.15, vignette: 0.35 } },
  { id: "mono", label: "Mono", adjust: { saturation: -1, contrast: 0.1 } },
  { id: "noir", label: "Noir", adjust: { saturation: -1, contrast: 0.45, vignette: 0.5 } },
];

/** Clips a look can apply to: the targets that are pictures, not sound. */
function visualTargets(): Id[] {
  const { project } = get();
  return targetClipIds().filter((id) => locateClip(project, id)?.track.kind === "video");
}

function needsClip(): void {
  notify({ kind: "error", message: "Select a video, image or text clip first." });
}

/**
 * Where a transition from the library goes: after the selected clip, or
 * when nothing is selected, at the main-track cut nearest the playhead.
 */
export function transitionTarget(): Id | undefined {
  const { selection, project, time } = get();
  if (selection.length > 1) return undefined;
  if (selection.length === 1) {
    const found = locateClip(project, selection[0]!);
    return found && followingClip(found.track, found.clip) ? found.clip.id : undefined;
  }
  const track = mainTrack(project);
  let best: { id: Id; distance: number } | undefined;
  for (const clip of track.clips) {
    if (!followingClip(track, clip)) continue;
    const distance = Math.abs(clipEnd(clip) - time);
    if (!best || distance < best.distance) best = { id: clip.id, distance };
  }
  return best?.id;
}

export function applyTransition(kind: string): void {
  const id = transitionTarget();
  if (!id) {
    notify({ kind: "error", message: "Transitions go between two clips that touch. Select the first of the two." });
    return;
  }
  applyTransitionAt(id, kind);
}

/** Puts a transition between a clip and the next, keeping the duration of any it replaces. */
export function applyTransitionAt(id: Id, kind: string): void {
  commit((project) => {
    const duration = findClip(project, id)?.transition?.duration ?? DEFAULT_TRANSITION_DURATION;
    return setTransition(project, id, { kind, duration });
  });
  select([id]);
}

/** Adds an effect at half strength to the target clips that don't already have it. */
export function addEffect(kind: EffectKind): void {
  const ids = visualTargets();
  if (ids.length === 0) return needsClip();
  commit((project) =>
    ids.reduce((next, id) => {
      const effects = findClip(next, id)?.effects ?? [];
      if (effects.some((effect) => effect.kind === kind)) return next;
      return updateClipLook(next, id, { effects: [...effects, { kind, amount: 0.5 }] });
    }, project),
  );
}

export function applyFilter(adjust: Partial<Adjustments>): void {
  const ids = visualTargets();
  if (ids.length === 0) return needsClip();
  commit((project) => ids.reduce((next, id) => updateClipLook(next, id, { adjust: { ...NEUTRAL_ADJUSTMENTS, ...adjust } }), project));
}

export function applyLut(assetId: Id): void {
  const ids = visualTargets();
  if (ids.length === 0) return needsClip();
  commit((project) => ids.reduce((next, id) => updateClipLook(next, id, { lut: { assetId, intensity: 1 } }), project));
}

/**
 * Sets a clip's black and white points from its own picture, taken from
 * the thumbnail nearest the middle of the clip.
 */
export function autoColor(clipId: Id): void {
  const { project, thumbnails } = get();
  const clip = findClip(project, clipId);
  if (!clip) return;
  const pictures = thumbnails.get(clip.assetId);
  if (!pictures || pictures.length === 0 || assetOf(project, clip).kind === "text") {
    notify({ kind: "warning", message: "Auto colour needs a picture of the clip. Try again once its thumbnails appear." });
    return;
  }
  const middle = toSourceTime(clip, Math.round((clip.start + clipEnd(clip)) / 2));
  const nearest = pictures.reduce((best, p) => (Math.abs(p.time - middle) < Math.abs(best.time - middle) ? p : best));
  const canvas = new OffscreenCanvas(nearest.image.width, nearest.image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(nearest.image, 0, 0);
  const { black, white } = analyzeColor(context.getImageData(0, 0, canvas.width, canvas.height).data);
  commit((p) => updateClipLook(p, clipId, { enhance: { autoColor: { black: [...black], white: [...white] } } }));
}
