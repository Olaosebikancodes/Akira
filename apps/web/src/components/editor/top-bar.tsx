"use client";

import { ExportCancelledError, type ExportOptions, exportInWorker, type Project, projectDuration } from "@akira/engine";
import { CheckIcon, DownloadSimpleIcon, ExportIcon, QuestionIcon, SquaresFourIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { ExportPanel, UploadTips } from "./export-panel";
import {
  DEFAULT_EXPORT,
  type ExportSettings,
  exportSize,
  formatSize,
  planMaster,
  TIKTOK_FINISH,
  tiktokBitrate,
  tiktokShortSide,
} from "./export-settings";
import { fontBaseUrl, notify, openTour, type SaveState, setProjectName, useEditor } from "./store";
import { Button, focusRing, IconButton } from "./ui";

type ExportState =
  | { kind: "idle" }
  | { kind: "running"; progress: number; controller: AbortController }
  | { kind: "done"; url: string; name: string; size: number; format: string; tiktok: boolean };

const QUALITY = { smaller: "medium", balanced: "high", best: "very-high" } as const;

const SAVE_LABELS: Record<SaveState, string> = {
  new: "",
  pending: "Saving…",
  saved: "Saved",
  error: "Not saved",
};

/** Where autosave is, announced politely so screen readers hear it without being interrupted. */
function SaveStatus() {
  const state = useEditor((s) => s.saveState);
  return (
    <span role="status" className={`flex shrink-0 items-center gap-1 text-xs ${state === "error" ? "text-danger" : "text-subtle"}`}>
      {state === "saved" && <CheckIcon size={12} weight="bold" aria-hidden />}
      {state === "error" && <WarningCircleIcon size={13} aria-hidden />}
      {SAVE_LABELS[state]}
    </span>
  );
}

export function TopBar() {
  const name = useEditor((s) => s.project.name);
  const hasContent = useEditor((s) => projectDuration(s.project) > 0);
  const [exporting, setExporting] = useState<ExportState>({ kind: "idle" });
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT);
  const [panel, setPanel] = useState<"settings" | "tips" | null>(null);

  /** What the chosen preset asks the export for, and what the file is called after it. */
  async function exportPlan(project: Project): Promise<{ options: Partial<ExportOptions>; suffix: string } | null> {
    if (settings.preset === "master") {
      const plan = await planMaster(project, settings.masterSize);
      if (!plan) return null;
      const { width, height, codec, bitrate, upscale } = plan;
      return { options: { format: "mp4", width, height, codecs: [codec], videoBitrate: bitrate, upscale }, suffix: " (Master)" };
    }
    if (settings.preset === "tiktok") {
      const size = exportSize(project, tiktokShortSide(settings.tiktokSize));
      const videoBitrate = tiktokBitrate(projectDuration(project), settings.tiktokSize);
      const suffix = settings.tiktokSize === "max" ? " (TikTok 4K)" : " (TikTok)";
      return { options: { format: "mp4", ...size, videoBitrate, finish: TIKTOK_FINISH }, suffix };
    }
    const size = exportSize(project, Number(settings.resolution));
    return { options: { format: settings.format, ...size, quality: QUALITY[settings.quality] }, suffix: "" };
  }

  async function runExport() {
    setPanel(null);
    const { project, files, player } = useEditor.getState();
    player?.pause();
    const tiktok = settings.preset === "tiktok";
    const plan = await exportPlan(project);
    if (!plan) {
      notify({ kind: "error", message: "This browser can't encode video that big." });
      return;
    }
    const format = plan.options.format ?? "mp4";
    const controller = new AbortController();
    setExporting({ kind: "running", progress: 0, controller });
    // Exporting in a worker keeps the editor responsive during long renders.
    const worker = new Worker(new URL("./workers/export.worker.ts", import.meta.url), { type: "module" });
    try {
      const blob = await exportInWorker(worker, project, files, {
        ...plan.options,
        signal: controller.signal,
        onProgress: (progress) => setExporting({ kind: "running", progress, controller }),
        fontBaseUrl: fontBaseUrl(),
      });
      const name = `${project.name || "Akira"}${plan.suffix}.${format}`;
      setExporting({ kind: "done", url: URL.createObjectURL(blob), name, size: blob.size, format: format === "webm" ? "WebM" : "MP4", tiktok });
      if (tiktok) setPanel("tips");
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
        <Link
          href="/projects"
          aria-label="All projects"
          title="All projects"
          className={`press -ml-1.5 grid size-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-foreground ${focusRing}`}
        >
          <SquaresFourIcon size={17} aria-hidden />
        </Link>
        <h1 className="sr-only text-[15px] font-semibold tracking-tight sm:not-sr-only">Akira</h1>
        <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
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
          className={`h-7 min-w-0 max-w-36 rounded-md sm:max-w-64 bg-transparent px-2 text-[13px] text-muted hover:bg-raised focus:bg-raised focus:text-foreground ${focusRing}`}
        />
        <SaveStatus />
      </div>

      <div data-tour="export" className="relative flex items-center gap-2" aria-live="polite">
        {/* The tour points at the desktop layout's panels. */}
        <span className="hidden lg:contents">
          <IconButton icon={QuestionIcon} label="Take the tour" onClick={openTour} />
        </span>
        {exporting.kind === "running" && (
          <>
            <progress value={exporting.progress} max={1} aria-label="Export progress" className="h-1.5 w-32 accent-accent" />
            <span className="w-9 text-right font-mono text-xs tabular-nums text-muted">{Math.floor(exporting.progress * 100)}%</span>
            <Button onClick={() => exporting.controller.abort()}>Cancel export</Button>
          </>
        )}
        {exporting.kind === "done" && (
          <>
            <span className="text-xs text-muted">Exported, {formatSize(exporting.size)}</span>
            <a
              href={exporting.url}
              download={exporting.name}
              className={`press inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover ${focusRing}`}
            >
              <DownloadSimpleIcon size={15} aria-hidden />
              Download {exporting.format}
            </a>
            <button type="button" aria-label="Dismiss export" onClick={dismiss} className={`press grid size-8 place-items-center rounded-md text-muted hover:bg-raised ${focusRing}`}>
              <XIcon size={15} aria-hidden />
            </button>
          </>
        )}
        {exporting.kind === "idle" && (
          <Button variant="primary" onClick={() => setPanel(panel === "settings" ? null : "settings")} disabled={!hasContent}>
            <ExportIcon size={15} aria-hidden />
            Export
          </Button>
        )}
        {panel === "settings" && exporting.kind === "idle" && (
          <ExportPanel settings={settings} onChange={setSettings} onExport={() => void runExport()} onClose={() => setPanel(null)} />
        )}
        {panel === "tips" && exporting.kind === "done" && <UploadTips onClose={() => setPanel(null)} />}
      </div>
    </header>
  );
}
