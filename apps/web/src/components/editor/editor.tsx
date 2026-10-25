"use client";

import { frameRateToNumber, setFontBaseUrl } from "@akira/engine";
import { WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
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
import { MediaPanel } from "./media-panel";
import { Preview } from "./preview";
import { dismissNotice, fontBaseUrl, redo, seek, select, selectAll, setSnapping, setZoom, togglePlayback, undo, useEditor } from "./store";
import { Timeline } from "./timeline/timeline";
import { TopBar } from "./top-bar";
import { focusRing } from "./ui";

export function Editor() {
  // The page measures text for the on-canvas handles, so it needs the fonts too.
  useEffect(() => setFontBaseUrl(fontBaseUrl()), []);
  useKeyboardShortcuts();
  useUnsavedWarning();

  return (
    <>
      <main className="hidden h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_minmax(220px,38vh)] lg:grid">
        <TopBar />
        <div className="grid min-h-0 grid-cols-[minmax(220px,17rem)_minmax(0,1fr)_minmax(240px,18rem)] gap-px bg-border">
          <MediaPanel />
          <Preview />
          <Inspector />
        </div>
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] border-t border-border">
          <Timeline />
        </div>
      </main>
      <SmallScreen />
      <Notices />
    </>
  );
}

/** Below 1024px the editor's panels don't fit; say so plainly instead of cramming them. */
function SmallScreen() {
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-3 px-6 lg:hidden">
      <h1 className="text-2xl font-semibold tracking-tight">Akira needs a bigger screen</h1>
      <p className="max-w-sm text-sm text-muted">
        The editor is built for laptops and desktops. Open this page on a screen at least 1024 pixels wide.
      </p>
    </main>
  );
}

function Notices() {
  const notices = useEditor((s) => s.notices);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
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

/** Nothing is saved yet, so leaving the page would lose the edit. Warn first. */
function useUnsavedWarning() {
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const { project } = useEditor.getState();
      if (project.tracks.some((track) => track.clips.length > 0)) event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
