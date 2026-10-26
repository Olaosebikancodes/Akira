"use client";

import {
  addCaptions,
  type Asset,
  computeWaveform,
  createId,
  createProject,
  createThumbnails,
  FPS_30,
  type Id,
  MediaFile,
  type Micros,
  parseSrt,
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

/** Where the bundled fonts are served from, as the absolute URL workers need. */
export function fontBaseUrl(): string {
  return `${location.origin}/fonts/`;
}

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

/**
 * Where autosave is: "new" until the project has anything worth keeping,
 * "pending" while changes wait to be written, then "saved", or "error" if
 * the browser refused.
 */
export type SaveState = "new" | "pending" | "saved" | "error";

/** Work running in the background, such as reversing a clip. */
export interface Job {
  id: Id;
  /** The clip it's for, so the same clip isn't started twice. */
  clipId: Id;
  label: string;
  /** 0 to 1. */
  progress: number;
  cancel: () => void;
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
  /** Bumped to ask the inspector to focus the text box, e.g. after double-clicking text. */
  textFocusRequest: number;
  notices: Notice[];
  player: Player | null;
  saveState: SaveState;
  /** True while a saved project's media is being opened. */
  opening: boolean;
  jobs: Job[];
  /** Set while the user draws a box on the canvas around something for a clip to follow. */
  trackingSetup: { followerId: Id; followScale: boolean } | null;
}

function blankProject(): Project {
  return createProject("Untitled project", {
    width: 1920,
    height: 1080,
    frameRate: FPS_30,
    background: { kind: "color", color: "#000000" },
  });
}

/** Everything about the open project, as it is for a new one. */
function freshProjectState(project: Project) {
  return {
    project,
    past: [],
    future: [],
    gestureStart: null,
    selection: [],
    time: 0,
    files: new Map<Id, MediaFile>(),
    thumbnails: new Map<Id, Thumbnail[]>(),
    waveforms: new Map<Id, Waveform>(),
    notices: [],
    saveState: "new" as SaveState,
  };
}

export const useEditor = create<EditorState>(() => ({
  ...freshProjectState(blankProject()),
  playing: false,
  zoom: 60,
  snapping: true,
  importing: 0,
  recording: null,
  textFocusRequest: 0,
  player: null,
  opening: false,
  jobs: [],
  trackingSetup: null,
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

/**
 * For sliders and typing: the first change starts a gesture and later ones
 * update it, so a whole adjustment is one undo step. Call endGesture when
 * the slider is released or the field loses focus.
 */
export function liveEdit(edit: Edit): void {
  if (!get().gestureStart) beginGesture();
  updateGesture(edit);
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

/** Starts a new, empty project, closing the media the last one had open. */
export function resetEditor(): void {
  for (const media of get().files.values()) media.dispose();
  set(freshProjectState(blankProject()));
}

/** Shows a saved project with its media, which `files` has already opened. */
export function loadProject(project: Project, files: Map<Id, MediaFile>): void {
  for (const media of get().files.values()) media.dispose();
  set({ ...freshProjectState(project), files, saveState: "saved" });
  for (const [assetId, media] of files) {
    const asset = project.assets[assetId];
    if (!asset) continue;
    void loadThumbnails(asset, media);
    void loadWaveform(asset, media);
  }
}

export function startJob(job: Omit<Job, "id" | "progress">): Id {
  const id = createId();
  set({ jobs: [...get().jobs, { ...job, id, progress: 0 }] });
  return id;
}

export function updateJob(id: Id, progress: number): void {
  set({ jobs: get().jobs.map((job) => (job.id === id ? { ...job, progress } : job)) });
}

export function finishJob(id: Id): void {
  set({ jobs: get().jobs.filter((job) => job.id !== id) });
}

/**
 * Changes an asset, such as storing motion measured from it. Like adding
 * one, it isn't an undo step: every snapshot gets the change, so undo never
 * loses work done in the background.
 */
export function updateAsset(assetId: Id, change: Partial<Asset>): void {
  const withChange = (project: Project): Project => {
    const asset = project.assets[assetId];
    return asset ? { ...project, assets: { ...project.assets, [assetId]: { ...asset, ...change } } } : project;
  };
  const { project, past, future, gestureStart } = get();
  set({
    project: withChange(project),
    past: past.map(withChange),
    future: future.map(withChange),
    gestureStart: gestureStart && withChange(gestureStart),
  });
}

export function setTrackingSetup(trackingSetup: EditorState["trackingSetup"]): void {
  set({ trackingSetup });
}

/** Adds media Akira made itself, such as a reversed copy. It isn't shown in the media panel. */
export function addGeneratedAsset(asset: Asset, media: MediaFile): void {
  addAsset(asset, media);
  void loadThumbnails(asset, media);
  void loadWaveform(asset, media);
}

export function setOpening(opening: boolean): void {
  set({ opening });
}

export function setSaveState(saveState: SaveState): void {
  if (get().saveState !== saveState) set({ saveState });
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
  // Captions aren't media: they go straight onto the timeline as text.
  const captions = files.filter((file) => /\.srt$/i.test(file.name));
  for (const file of captions) void importCaptions(file);
  const media = files.filter((file) => !captions.includes(file));

  set({ importing: get().importing + media.length });
  const added: Asset[] = [];
  for (const file of media) {
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

/** Reads an .srt file and adds a caption clip per cue on a new track. */
export async function importCaptions(file: File): Promise<void> {
  const cues = parseSrt(await file.text());
  if (cues.length === 0) {
    notify({ kind: "error", message: `No captions were found in ${file.name}. Check that it's a SubRip (.srt) file.` });
    return;
  }
  let clipIds: Id[] = [];
  commit((project) => {
    const result = addCaptions(project, cues);
    clipIds = result.clipIds;
    return result.project;
  });
  set({ selection: clipIds });
}

export function requestTextFocus(): void {
  set({ textFocusRequest: get().textFocusRequest + 1 });
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
