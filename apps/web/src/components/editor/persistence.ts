"use client";

import { type Id, MediaFile, type Project, ProjectLibrary, type Thumbnail } from "@akira/engine";
import { loadProject, notify, setOpening, setSaveState, useEditor } from "./store";

/** Edits are written this long after the last change, so a drag saves once, not every frame. */
const SAVE_DELAY = 600;
const THUMBNAIL_WIDTH = 320;

let library: Promise<ProjectLibrary> | null = null;

/** The browser's project library, opened once per page. */
export function projectLibrary(): Promise<ProjectLibrary> {
  library ??= ProjectLibrary.open();
  return library;
}

/** The project the editor last loaded or wrote, so loading one doesn't count as an edit. */
let lastSaved: Project | null = null;
/** Assets whose media is in storage, or on its way there, by project. */
const stored = new Map<Id, Set<Id>>();
/** Set when the last save had no picture for the project list yet. */
let needsThumbnail = false;

/** Opens a saved project in the editor. Returns false if it isn't on this device. */
export async function openSavedProject(id: Id): Promise<boolean> {
  setOpening(true);
  try {
    return await openProject(id);
  } finally {
    setOpening(false);
  }
}

async function openProject(id: Id): Promise<boolean> {
  const loaded = await (await projectLibrary()).load(id);
  if (!loaded) return false;
  const files = new Map<Id, MediaFile>();
  for (const [assetId, file] of loaded.files) {
    try {
      files.set(assetId, await MediaFile.open(file));
    } catch (error) {
      notify({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  lastSaved = loaded.project;
  stored.set(loaded.project.id, new Set(loaded.files.keys()));
  loadProject(loaded.project, files);
  if (loaded.missing.length > 0) {
    const names = loaded.missing.map((assetId) => loaded.project.assets[assetId]?.name ?? "A file").join(", ");
    notify({ kind: "warning", message: `${names} didn't finish saving before the page closed. Import it again to use it.` });
  }
  return true;
}

/**
 * Saves the open project shortly after each change, and copies new media
 * into storage. A new project isn't saved until it has something in it.
 * Returns a function that stops autosaving.
 */
export function startAutosave(): () => void {
  let timer: number | undefined;
  let writing: Promise<void> = Promise.resolve();

  const unsubscribe = useEditor.subscribe((state, previous) => {
    const changed = state.project !== previous.project || state.files !== previous.files;
    // Thumbnails arrive after the media is added, so a first save may have had none to show.
    const thumbnailArrived = needsThumbnail && state.thumbnails !== previous.thumbnails;
    if (!changed && !thumbnailArrived) return;
    if (state.project === lastSaved && !thumbnailArrived) return;
    if (state.saveState === "new" && !hasContent(state.project)) return;
    setSaveState("pending");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Saves run one at a time, so an older one can never land after a newer one.
      writing = writing.then(save);
    }, SAVE_DELAY);
  });

  return () => {
    window.clearTimeout(timer);
    unsubscribe();
  };
}

async function save(): Promise<void> {
  const { project, files, thumbnails } = useEditor.getState();
  try {
    const library = await projectLibrary();
    const first = !(await library.has(project.id));
    if (first) void navigator.storage?.persist?.();

    const thumbnail = await projectThumbnail(project, thumbnails);
    needsThumbnail = thumbnail === undefined;
    await library.save(project, thumbnail);
    lastSaved = project;
    if (first) history.replaceState(null, "", `/editor?project=${project.id}`);

    const done = stored.get(project.id) ?? new Set<Id>();
    stored.set(project.id, done);
    for (const [assetId, media] of files) {
      if (done.has(assetId)) continue;
      done.add(assetId);
      if (!(await library.hasMedia(project.id, assetId))) await library.storeMedia(project.id, assetId, media.file);
    }
    // Only report saved if nothing changed while this was being written.
    if (useEditor.getState().project === project) setSaveState("saved");
  } catch (error) {
    setSaveState("error");
    const full = error instanceof DOMException && error.name === "QuotaExceededError";
    notify({
      kind: "error",
      message: full
        ? "Your browser is out of space for Akira's projects. Delete old projects to make room."
        : `This project couldn't be saved. ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function hasContent(project: Project): boolean {
  return Object.keys(project.assets).length > 0 || project.tracks.some((track) => track.clips.length > 0);
}

/** The first frame of the first clip, small, for the project list. Undefined keeps the saved one. */
async function projectThumbnail(project: Project, thumbnails: ReadonlyMap<Id, Thumbnail[]>): Promise<Blob | null | undefined> {
  const first = project.tracks[0]?.clips[0];
  if (!first) return null;
  const picture = thumbnails.get(first.assetId)?.[0]?.image;
  if (!picture) return undefined;
  const height = Math.round((picture.height / picture.width) * THUMBNAIL_WIDTH);
  const canvas = new OffscreenCanvas(THUMBNAIL_WIDTH, height);
  canvas.getContext("2d")!.drawImage(picture, 0, 0, THUMBNAIL_WIDTH, height);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}
