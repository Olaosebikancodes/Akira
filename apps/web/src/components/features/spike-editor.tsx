"use client";

import {
  type Asset,
  type Clip,
  createClip,
  createId,
  createProject,
  createTrack,
  ExportCancelledError,
  exportProject,
  FPS_30,
  formatTimecode,
  frameRateToNumber,
  frameToMicros,
  type Id,
  MediaFile,
  microsToFrame,
  Player,
  type Project,
  projectDuration,
  snapToFrame,
  toSourceTime,
} from "@akira/engine";
import { type ChangeEvent, type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";

/** Projects take the footage's size, capped so 8K sources still preview smoothly. */
const MAX_CANVAS_EDGE = 3840;

interface Session {
  project: Project;
  files: Map<Id, MediaFile>;
  warnings: readonly string[];
}

interface ExportState {
  progress: number;
  controller: AbortController;
}

interface Download {
  url: string;
  name: string;
  size: number;
}

/**
 * A single-clip editor that exercises the engine end to end: import, play,
 * scrub, step frames, trim, export. The real multi-track editor replaces it.
 */
export function SpikeEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<ExportState | null>(null);
  const [download, setDownload] = useState<Download | null>(null);

  const project = session?.project;
  const clip = project?.tracks.flatMap((track) => track.clips)[0];
  const asset = clip && project?.assets[clip.assetId];
  const frameRate = project?.canvas.frameRate ?? FPS_30;
  const duration = project ? projectDuration(project) : 0;
  const ready = Boolean(session);

  useEffect(() => {
    return () => {
      void playerRef.current?.dispose();
      sessionRef.current?.files.forEach((file) => file.dispose());
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const player = playerRef.current;
      const target = event.target;
      if (!player || (target instanceof HTMLInputElement && target.type !== "range")) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlayback(player);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        stepFrames(player, event.key === "ArrowLeft" ? -1 : 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function importFile(file: File) {
    setLoading(true);
    setError(null);
    let media: MediaFile;
    try {
      media = await MediaFile.open(file);
    } catch (cause) {
      setError(messageOf(cause));
      setLoading(false);
      return;
    }

    await playerRef.current?.dispose();
    sessionRef.current?.files.forEach((existing) => existing.dispose());

    const imported: Asset = { id: createId(), ...media.info };
    const next: Session = {
      project: projectFor(imported),
      files: new Map([[imported.id, media]]),
      warnings: media.warnings,
    };
    sessionRef.current = next;
    playerRef.current = new Player(canvasRef.current!, next.project, next.files, {
      onTimeUpdate: setTime,
      onPlayingChange: setPlaying,
      onError: (cause) => setError(messageOf(cause)),
    });

    if (download) URL.revokeObjectURL(download.url);
    setDownload(null);
    setTime(0);
    setSession(next);
    setLoading(false);
  }

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importFile(file);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void importFile(file);
  }

  function updateClip(update: (clip: Clip) => Clip) {
    if (!session) return;
    const next: Session = {
      ...session,
      project: {
        ...session.project,
        tracks: session.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map(update),
        })),
      },
    };
    sessionRef.current = next;
    setSession(next);
    playerRef.current?.setProject(next.project, next.files);
  }

  function setInPoint() {
    if (!clip) return;
    const sourceIn = toSourceTime(clip, snapToFrame(time, frameRate));
    if (sourceIn >= clip.sourceOut - frameToMicros(1, frameRate)) return;
    updateClip((c) => ({ ...c, sourceIn }));
    playerRef.current?.seek(0);
  }

  function setOutPoint() {
    if (!clip) return;
    const sourceOut = toSourceTime(clip, snapToFrame(time, frameRate));
    if (sourceOut <= clip.sourceIn) return;
    updateClip((c) => ({ ...c, sourceOut }));
  }

  function resetTrim() {
    if (!asset) return;
    updateClip((c) => ({ ...c, sourceIn: asset.start, sourceOut: asset.start + asset.duration }));
  }

  async function runExport() {
    if (!session) return;
    playerRef.current?.pause();
    const controller = new AbortController();
    setError(null);
    setExporting({ progress: 0, controller });
    try {
      const blob = await exportProject(session.project, session.files, {
        signal: controller.signal,
        onProgress: (progress) => setExporting({ progress, controller }),
      });
      if (download) URL.revokeObjectURL(download.url);
      setDownload({
        url: URL.createObjectURL(blob),
        name: `${session.project.name}-akira.mp4`,
        size: blob.size,
      });
    } catch (cause) {
      if (!(cause instanceof ExportCancelledError)) setError(messageOf(cause));
    } finally {
      setExporting(null);
    }
  }

  function onPlayPause() {
    if (playerRef.current) togglePlayback(playerRef.current);
  }

  function onStep(frames: number) {
    if (playerRef.current) stepFrames(playerRef.current, frames);
  }

  const trimmedIn = clip && asset ? clip.sourceIn - asset.start : 0;
  const trimmedOut = clip && asset ? clip.sourceOut - asset.start : 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Akira</h1>
          <span className="text-sm text-muted">Engine test</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="import"
            type="file"
            accept="video/*,audio/*"
            className="peer sr-only"
            onChange={onFileChosen}
            disabled={loading || Boolean(exporting)}
          />
          <label
            htmlFor="import"
            className="cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          >
            {loading ? "Opening…" : "Import video"}
          </label>
          <button
            type="button"
            onClick={() => void runExport()}
            disabled={!ready || Boolean(exporting)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export MP4
          </button>
        </div>
      </header>

      <section
        aria-label="Preview"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="relative grid min-h-[40vh] place-items-center overflow-hidden rounded-lg bg-stage"
      >
        <canvas
          ref={canvasRef}
          className={ready ? "max-h-[62vh] max-w-full" : "hidden"}
          style={project ? { aspectRatio: `${project.canvas.width} / ${project.canvas.height}` } : undefined}
        />
        {!ready && (
          <p className="px-6 text-center text-sm text-white/60">
            Drop a video here or use Import video. Nothing is uploaded.
          </p>
        )}
      </section>

      <section aria-label="Transport" className="flex flex-col gap-3">
        <input
          type="range"
          aria-label="Playhead"
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={time}
          disabled={!ready}
          onChange={(event) => playerRef.current?.seek(Math.round(Number(event.target.value)))}
          className="w-full accent-accent"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <TransportButton label="Previous frame" disabled={!ready} onClick={() => onStep(-1)}>
              ‹
            </TransportButton>
            <TransportButton
              label={playing ? "Pause" : "Play"}
              disabled={!ready}
              onClick={onPlayPause}
              wide
            >
              {playing ? "Pause" : "Play"}
            </TransportButton>
            <TransportButton label="Next frame" disabled={!ready} onClick={() => onStep(1)}>
              ›
            </TransportButton>
          </div>
          <p className="font-mono text-sm tabular-nums">
            <output aria-label="Current time">{formatTimecode(time, frameRate)}</output>
            <span className="text-muted"> / </span>
            <output aria-label="Duration" className="text-muted">
              {formatTimecode(duration, frameRate)}
            </output>
          </p>
        </div>
      </section>

      <section aria-label="Trim" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-3 text-sm">
        <span className="font-medium">Trim</span>
        <span className="font-mono tabular-nums text-muted">
          In <output aria-label="In point">{formatTimecode(trimmedIn, frameRate)}</output>
          {" · "}
          Out <output aria-label="Out point">{formatTimecode(trimmedOut, frameRate)}</output>
        </span>
        <div className="flex gap-2">
          <SmallButton disabled={!ready} onClick={setInPoint}>Set in point</SmallButton>
          <SmallButton disabled={!ready} onClick={setOutPoint}>Set out point</SmallButton>
          <SmallButton disabled={!ready} onClick={resetTrim}>Reset trim</SmallButton>
        </div>
      </section>

      {exporting && (
        <section aria-label="Export progress" className="flex items-center gap-3 text-sm">
          <progress value={exporting.progress} max={1} className="h-2 flex-1 accent-accent" />
          <span className="w-12 text-right font-mono tabular-nums">{Math.floor(exporting.progress * 100)}%</span>
          <SmallButton onClick={() => exporting.controller.abort()}>Cancel export</SmallButton>
        </section>
      )}

      {download && (
        <p role="status" className="text-sm">
          Export finished ({(download.size / 1_000_000).toFixed(1)} MB).{" "}
          <a href={download.url} download={download.name} className="font-medium text-accent underline underline-offset-2">
            Download MP4
          </a>
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {asset && project && (
        <p className="text-sm text-muted">
          {asset.name} · {asset.video ? `${asset.video.width}×${asset.video.height} · ` : "Audio only · "}
          {frameRateToNumber(frameRate).toFixed(2)} fps
          {asset.audio ? ` · ${asset.audio.sampleRate / 1000} kHz audio` : " · No audio"}
          {session?.warnings.map((warning) => (
            <span key={warning} className="block text-danger">
              {warning}
            </span>
          ))}
        </p>
      )}

      <p className="mt-auto text-xs text-muted">Space plays and pauses. Arrow keys step one frame.</p>
    </main>
  );
}

function togglePlayback(player: Player) {
  if (player.isPlaying) player.pause();
  else void player.play();
}

function stepFrames(player: Player, frames: number) {
  if (player.isPlaying) player.pause();
  const rate = player.frameRate;
  player.seek(frameToMicros(Math.max(0, microsToFrame(player.currentTime, rate) + frames), rate));
}

function projectFor(asset: Asset): Project {
  const video = asset.video;
  const scale = video ? Math.min(1, MAX_CANVAS_EDGE / Math.max(video.width, video.height)) : 1;
  const project = createProject(stripExtension(asset.name), {
    width: video ? even(video.width * scale) : 1280,
    height: video ? even(video.height * scale) : 720,
    frameRate: video?.frameRate ?? FPS_30,
    background: { kind: "color", color: "#000000" },
  });
  project.assets[asset.id] = asset;
  const track = asset.kind === "audio" ? createTrack("audio") : project.tracks[0]!;
  if (asset.kind === "audio") project.tracks.push(track);
  track.clips.push(createClip(asset, 0));
  return project;
}

/** H.264 needs even dimensions. */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "Untitled";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function TransportButton({
  label,
  children,
  wide = false,
  ...props
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`h-9 rounded-md border border-border bg-surface text-sm font-medium transition-colors hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${wide ? "w-20" : "w-9"}`}
      {...props}
    >
      {children}
    </button>
  );
}

function SmallButton({
  children,
  ...props
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-md border border-border px-2.5 py-1 font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}
