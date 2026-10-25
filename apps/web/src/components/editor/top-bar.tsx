"use client";

import { ExportCancelledError, exportInWorker, projectDuration } from "@akira/engine";
import { DownloadSimpleIcon, ExportIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { notify, setProjectName, useEditor } from "./store";
import { Button, focusRing } from "./ui";

type ExportState =
  | { kind: "idle" }
  | { kind: "running"; progress: number; controller: AbortController }
  | { kind: "done"; url: string; name: string; size: number };

export function TopBar() {
  const name = useEditor((s) => s.project.name);
  const hasContent = useEditor((s) => projectDuration(s.project) > 0);
  const [exporting, setExporting] = useState<ExportState>({ kind: "idle" });

  async function runExport() {
    const { project, files, player } = useEditor.getState();
    player?.pause();
    const controller = new AbortController();
    setExporting({ kind: "running", progress: 0, controller });
    // Exporting in a worker keeps the editor responsive during long renders.
    const worker = new Worker(new URL("./workers/export.worker.ts", import.meta.url), { type: "module" });
    try {
      const blob = await exportInWorker(worker, project, files, {
        signal: controller.signal,
        onProgress: (progress) => setExporting({ kind: "running", progress, controller }),
      });
      setExporting({ kind: "done", url: URL.createObjectURL(blob), name: `${project.name || "Akira"}.mp4`, size: blob.size });
    } catch (error) {
      setExporting({ kind: "idle" });
      if (!(error instanceof ExportCancelledError)) {
        notify({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      worker.terminate();
    }
  }

  function dismiss() {
    if (exporting.kind === "done") URL.revokeObjectURL(exporting.url);
    setExporting({ kind: "idle" });
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-panel px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Akira</h1>
        <span aria-hidden className="h-4 w-px bg-border" />
        <label className="sr-only" htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          name="project-name"
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(event) => setProjectName(event.target.value)}
          className={`h-7 min-w-0 max-w-64 rounded-md bg-transparent px-2 text-[13px] text-muted hover:bg-raised focus:bg-raised focus:text-foreground ${focusRing}`}
        />
      </div>

      <div className="flex items-center gap-2" aria-live="polite">
        {exporting.kind === "running" && (
          <>
            <progress value={exporting.progress} max={1} aria-label="Export progress" className="h-1.5 w-32 accent-accent" />
            <span className="w-9 text-right font-mono text-xs tabular-nums text-muted">{Math.floor(exporting.progress * 100)}%</span>
            <Button onClick={() => exporting.controller.abort()}>Cancel export</Button>
          </>
        )}
        {exporting.kind === "done" && (
          <>
            <span className="text-xs text-muted">Exported, {(exporting.size / 1_000_000).toFixed(1)}&nbsp;MB</span>
            <a
              href={exporting.url}
              download={exporting.name}
              className={`press inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover ${focusRing}`}
            >
              <DownloadSimpleIcon size={15} aria-hidden />
              Download MP4
            </a>
            <button type="button" aria-label="Dismiss export" onClick={dismiss} className={`press grid size-8 place-items-center rounded-md text-muted hover:bg-raised ${focusRing}`}>
              <XIcon size={15} aria-hidden />
            </button>
          </>
        )}
        {exporting.kind === "idle" && (
          <Button variant="primary" onClick={() => void runExport()} disabled={!hasContent}>
            <ExportIcon size={15} aria-hidden />
            Export
          </Button>
        )}
      </div>
    </header>
  );
}
