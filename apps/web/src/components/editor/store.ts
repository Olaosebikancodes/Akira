"use client";

import {
  type Asset,
  computeWaveform,
  createId,
  createProject,
  createThumbnails,
  FPS_30,
  type Id,
  MediaFile,
  type Micros,
  type Player,
  type Project,
  type Thumbnail,
  type Waveform,
} from "@akira/engine";
import { create } from "zustand";
import type { Recording } from "./recorder";

/** Undo steps kept. Projects share structure, so each step costs little. */
const HISTORY_LIMIT = 200;
/** Timeline zoom limits, in pixels per second. */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 600;
const FILMSTRIP_HEIGHT = 96;

export type Edit = (project: Project) => Project;

/** A voiceover being recorded over playback. */
export interface VoiceoverSession {
  /** Where the playhead was when recording started. */
  from: Micros;
  /** Wall-clock time `from` was heard, to line the take up; null if nothing was playing. */
  heardAt: number | null;
  take: Recording;
}

export interface Notice {
  kind: "error" | "warning";
  message: string;
}

interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  /** The project as it was when a drag began, so the whole drag undoes in one step. */
  gestureStart: Project | null;

  selection: Id[];
  time: Micros;
  playing: boolean;
  /** Pixels per second on the timeline. */
  zoom: number;
  snapping: boolean;

  /** Opened media, by asset id. Kept outside the project because it can't be serialised. */
  files: ReadonlyMap<Id, MediaFile>;
  thumbnails: ReadonlyMap<Id, Thumbnail[]>;
  waveforms: ReadonlyMap<Id, Waveform>;
  importing: number;
  recording: VoiceoverSession | null;
  notices: Notice[];
  player: Player | null;
}

export const useEditor = create<EditorState>(() => ({
  project: createProject("Untitled project", {
    width: 1920,
    height: 1080,
    frameRate: FPS_30,
    background: { kind: "color", color: "#000000" },
  }),
  past: [],
  future: [],
  gestureStart: null,
  selection: [],
  time: 0,
  playing: false,
  zoom: 60,
  snapping: true,
  files: new Map(),
  thumbnails: new Map(),
  waveforms: new Map(),
  importing: 0,
  recording: null,
  notices: [],
  player: null,
}));

const set = useEditor.setState;
const get = useEditor.getState;

/** Applies an edit as one undoable step. Edits that change nothing aren't recorded. */
export function commit(edit: Edit): void {
  const { project, past, gestureStart } = get();
  if (gestureStart) return updateGesture(edit);
  const next = edit(project);
  if (next === project) return;
  set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  pruneSelection();
}

export function beginGesture(): void {
  set({ gestureStart: get().project });
}

/**
 * Applies `edit` to the project as it was when the gesture began. Drags
 * recompute from that snapshot on every move instead of stacking changes,
 * so they never drift.
 */
export function updateGesture(edit: Edit): void {
  const { gestureStart } = get();
  if (!gestureStart) return;
  set({ project: edit(gestureStart) });
}

export function endGesture(): void {
  const { gestureStart, project, past } = get();
  if (!gestureStart) return;
  if (project === gestureStart) return set({ gestureStart: null });
  set({ gestureStart: null, past: [...past, gestureStart].slice(-HISTORY_LIMIT), future: [] });
  pruneSelection();
}

export function undo(): void {
  const { past, project, future, gestureStart } = get();
  const previous = past.at(-1);
  if (!previous || gestureStart) return;
  set({ project: previous, past: past.slice(0, -1), future: [project, ...future] });
  pruneSelection();
}

export function redo(): void {
  const { past, project, future, gestureStart } = get();
  const next = future[0];
  if (!next || gestureStart) return;
  set({ project: next, past: [...past, project], future: future.slice(1) });
  pruneSelection();
}

export function select(ids: Id[], mode: "replace" | "toggle" = "replace"): void {
  if (mode === "replace") return set({ selection: ids });
  const selection = new Set(get().selection);
  for (const id of ids) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
  }
  set({ selection: [...selection] });
}

export function selectAll(): void {
  set({ selection: get().project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)) });
}

/** Drops selected ids whose clips no longer exist, e.g. after undo. */
function pruneSelection(): void {
  const { selection, project } = get();
  if (selection.length === 0) return;
  const live = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  const kept = selection.filter((id) => live.has(id));
  if (kept.length !== selection.length) set({ selection: kept });
}

export function seek(time: Micros): void {
  const player = get().player;
  if (player) player.seek(time);
  else set({ time: Math.max(0, time) });
}

export function togglePlayback(): void {
  const player = get().player;
  if (!player) return;
  if (player.isPlaying) player.pause();
  else void player.play();
}

export function setZoom(zoom: number): void {
  set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) });
}

export function setSnapping(snapping: boolean): void {
  set({ snapping });
}

export function setProjectName(name: string): void {
  // Renaming isn't worth an undo step.
  set({ project: { ...get().project, name } });
}

export function notify(notice: Notice): void {
  set({ notices: [...get().notices, notice].slice(-3) });
}

export function dismissNotice(notice: Notice): void {
  set({ notices: get().notices.filter((n) => n !== notice) });
}

/**
 * Opens files and adds them to the media panel. Assets aren't part of undo:
 * every snapshot gains them, so undoing never makes media vanish.
 */
export async function importFiles(files: readonly File[]): Promise<Asset[]> {
  set({ importing: get().importing + files.length });
  const added: Asset[] = [];
  for (const file of files) {
    try {
      const media = await MediaFile.open(file);
      const asset: Asset = { id: createId(), ...media.info };
      addAsset(asset, media);
      for (const message of media.warnings) notify({ kind: "warning", message });
      added.push(asset);
      void loadThumbnails(asset, media);
      void loadWaveform(asset, media);
    } catch (error) {
      notify({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ importing: get().importing - 1 });
    }
  }
  return added;
}

function addAsset(asset: Asset, media: MediaFile): void {
  const withAsset = (project: Project): Project => ({
    ...project,
    assets: { ...project.assets, [asset.id]: asset },
  });
  const { project, past, future, gestureStart, files } = get();
  const nextFiles = new Map(files);
  nextFiles.set(asset.id, media);
  set({
    project: withAsset(project),
    past: past.map(withAsset),
    future: future.map(withAsset),
    gestureStart: gestureStart && withAsset(gestureStart),
    files: nextFiles,
  });
}

async function loadWaveform(asset: Asset, media: MediaFile): Promise<void> {
  if (!asset.audio) return;
  try {
    const waveform = await computeWaveform(media);
    if (!waveform) return;
    const next = new Map(get().waveforms);
    next.set(asset.id, waveform);
    set({ waveforms: next });
  } catch {
    // Like thumbnails, a waveform is a nicety; the clip still plays without it.
  }
}

async function loadThumbnails(asset: Asset, media: MediaFile): Promise<void> {
  const count = asset.kind === "video" ? Math.min(60, Math.max(4, Math.round(asset.duration / 1_000_000))) : 1;
  try {
    const thumbnails = await createThumbnails(media, count, FILMSTRIP_HEIGHT);
    const next = new Map(get().thumbnails);
    next.set(asset.id, thumbnails);
    set({ thumbnails: next });
  } catch {
    // Thumbnails are a nicety; the clip still works without them.
  }
}
