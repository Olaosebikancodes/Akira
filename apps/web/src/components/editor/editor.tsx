"use client";

import { frameRateToNumber, setFontBaseUrl } from "@akira/engine";
import { WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import {
  deleteSelection,
  duplicateSelection,
  freezeAtPlayhead,
  nudgeSelection,
  seekToEdit,
  seekToEnd,
  splitAtPlayhead,
  stepFrames,
  toggleMarkerAtPlayhead,
  trimToPlayhead,
  zoomToFit,
} from "./actions";
import { Inspector } from "./inspector";
import { LeftPanel } from "./left-panel";
import { MobileEditor } from "./mobile-editor";
import { openSavedProject, startAutosave } from "./persistence";
import { Preview } from "./preview";
import {
  dismissNotice,
  fontBaseUrl,
  notify,
  openTourIfNew,
  redo,
  resetEditor,
  seek,
  select,
  selectAll,
  setSnapping,
  setZoom,
  togglePlayback,
  undo,
  useEditor,
} from "./store";
import { Timeline } from "./timeline/timeline";
import { TopBar } from "./top-bar";
import { Tour } from "./tour";
import { focusRing } from "./ui";

export function Editor() {
  // The page measures text for the on-canvas handles, so it needs the fonts too.
  useEffect(() => setFontBaseUrl(fontBaseUrl()), []);
  const opening = useOpenProject();
  const touring = useEditor((s) => s.tourOpen);
  useKeyboardShortcuts();
  useUnsavedWarning();
  const wide = useWideScreen();
  // First-timers get a short tour of the desktop editor; Help replays it.
  useEffect(() => {
    if (window.matchMedia(WIDE).matches) openTourIfNew();
  }, []);

  // Only one layout is ever mounted: each has its own preview, and so its own player.
  if (!wide) {
    return (
      <>
        <MobileEditor opening={opening} />
        <Notices />
      </>
    );
  }

  return (
    <>
      <main aria-busy={opening} className="relative grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_minmax(220px,38vh)]">
        <TopBar />
        <div className="grid min-h-0 grid-cols-[minmax(220px,17rem)_minmax(0,1fr)_minmax(240px,18rem)] gap-px bg-border">
          <LeftPanel />
          <Preview />
          <Inspector />
        </div>
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] border-t border-border">
          <Timeline />
        </div>
        {opening && (
          <div className="absolute inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
            <p className="text-sm text-muted">Opening project…</p>
          </div>
        )}
      </main>
      <Notices />
      {touring && <Tour />}
    </>
  );
}

/** Wide enough for the desktop layout's three columns. */
const WIDE = "(min-width: 1024px)";

/** Whether the desktop layout fits, following the window as it's resized or a tablet turns. */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

function Notices() {
  const notices = useEditor((s) => s.notices);
  const jobs = useEditor((s) => s.jobs);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {jobs.map((job) => (
        // Background work, such as reversing a clip, with its progress and a way out.
        <div
          key={job.id}
          role="status"
          className="pointer-events-auto flex flex-col gap-2 rounded-lg border border-border-strong bg-raised p-3 text-xs shadow-[0_8px_24px_oklch(0%_0_0/0.4)]"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-foreground">{job.label}…</p>
            <span className="font-mono tabular-nums text-muted">{Math.floor(job.progress * 100)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <progress value={job.progress} max={1} aria-label={`${job.label} progress`} className="h-1.5 flex-1 accent-accent" />
            <button type="button" onClick={job.cancel} className={`press rounded px-1.5 py-0.5 text-muted hover:bg-raised-hover hover:text-foreground ${focusRing}`}>
              Cancel
            </button>
          </div>
        </div>
      ))}
      {notices.map((notice, index) => (
        <div
          key={`${index}-${notice.message}`}
          role={notice.kind === "error" ? "alert" : "status"}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-border-strong bg-raised p-3 text-xs shadow-[0_8px_24px_oklch(0%_0_0/0.4)]"
        >
          <WarningCircleIcon size={16} aria-hidden className={notice.kind === "error" ? "shrink-0 text-danger" : "shrink-0 text-warning"} />
          <p className="flex-1 text-foreground">{notice.message}</p>
          <button type="button" aria-label="Dismiss" onClick={() => dismissNotice(notice)} className={`press -m-1 grid size-6 place-items-center rounded text-muted hover:text-foreground ${focusRing}`}>
            <XIcon size={13} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Editing shortcuts. They step aside while typing in a field. */
function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing =
        target.isContentEditable ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && target.type !== "range" && target.type !== "file");
      if (typing) return;

      const { project, zoom, snapping } = useEditor.getState();
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      const second = Math.round(frameRateToNumber(project.canvas.frameRate));

      if (command) {
        if (key === "z") return run(event.shiftKey ? redo : undo);
        if (key === "y") return run(redo);
        if (key === "d") return run(duplicateSelection);
        if (key === "a") return run(selectAll);
        if (key === "b") return run(splitAtPlayhead);
        return;
      }

      switch (event.key) {
        case " ":
          return run(togglePlayback);
        case "ArrowLeft":
          return run(() => (event.altKey ? nudgeSelection(-1) : stepFrames(event.shiftKey ? -second : -1)));
        case "ArrowRight":
          return run(() => (event.altKey ? nudgeSelection(1) : stepFrames(event.shiftKey ? second : 1)));
        case "ArrowUp":
          return run(() => seekToEdit(-1));
        case "ArrowDown":
          return run(() => seekToEdit(1));
        case "Home":
          return run(() => seek(0));
        case "End":
          return run(seekToEnd);
        case "Delete":
        case "Backspace":
          return run(() => deleteSelection(event.shiftKey));
        case "Escape":
          return run(() => select([]));
      }

      switch (key) {
        case "s":
          return run(splitAtPlayhead);
        case "q":
          return run(() => trimToPlayhead("start"));
        case "w":
          return run(() => trimToPlayhead("end"));
        case "f":
          return run(freezeAtPlayhead);
        case "m":
          return run(toggleMarkerAtPlayhead);
        case "n":
          return run(() => setSnapping(!snapping));
        case "=":
        case "+":
          return run(() => setZoom(zoom * 1.5));
        case "-":
          return run(() => setZoom(zoom / 1.5));
        case "z":
          if (event.shiftKey) return run(() => zoomToFit(window.innerWidth - 120));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Opens the project named in the address (?project=id), or starts a new one,
 * whenever the address changes, and autosaves throughout. True while a
 * saved project is opening.
 */
function useOpenProject(): boolean {
  const id = useSearchParams().get("project");
  useEffect(() => startAutosave(), []);
  useEffect(() => {
    // A new project's first save puts its id in the address; it's already open.
    if (id && id === useEditor.getState().project.id) return;
    if (!id) {
      // Only clear a project that was saved or has work in it; resetting a blank one would wipe its notices.
      const { saveState, project } = useEditor.getState();
      if (saveState !== "new" || project.tracks.some((track) => track.clips.length > 0)) resetEditor();
      return;
    }
    void openSavedProject(id).then((found) => {
      if (found) return;
      resetEditor();
      history.replaceState(null, "", "/editor");
      notify({ kind: "error", message: "That project isn't saved in this browser. It may have been deleted." });
    });
  }, [id]);
  return useEditor((s) => s.opening);
}

/** Projects save themselves, so only warn when leaving would lose a change still being written. */
function useUnsavedWarning() {
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const { saveState } = useEditor.getState();
      if (saveState === "pending" || saveState === "error") event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
