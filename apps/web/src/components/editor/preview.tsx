"use client";

import { formatTimecode, Player, projectDuration } from "@akira/engine";
import {
  CaretLeftIcon,
  CaretRightIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { seekToEdit, stepFrames } from "./actions";
import { CanvasOverlay } from "./canvas-overlay";
import { TrackingOverlay } from "./tracking-overlay";
import { fontBaseUrl, notify, togglePlayback, useEditor } from "./store";
import { IconButton } from "./ui";

/** The canvas the project plays in, its on-canvas handles and the transport bar. */
export function Preview() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const project = useEditor((s) => s.project);
  const files = useEditor((s) => s.files);
  const empty = project.tracks.every((track) => track.clips.length === 0);
  const tracking = useEditor((s) => s.trackingSetup !== null);

  useEffect(() => {
    // A canvas can be handed to a worker only once, so every mount makes a fresh one.
    const canvas = document.createElement("canvas");
    canvas.className = "block size-full shadow-[0_0_0_1px_var(--border)]";
    canvas.setAttribute("aria-label", "Video preview");
    hostRef.current!.prepend(canvas);

    const { project: initial, files: initialFiles } = useEditor.getState();
    const renderWorker = new Worker(new URL("./workers/render.worker.ts", import.meta.url), { type: "module" });
    const player = new Player(
      canvas,
      initial,
      initialFiles,
      {
        onTimeUpdate: (time) => useEditor.setState({ time }),
        onPlayingChange: (playing) => useEditor.setState({ playing }),
        onError: (error) => notify({ kind: "error", message: error instanceof Error ? error.message : String(error) }),
      },
      { renderWorker, fontBaseUrl: fontBaseUrl() },
    );
    useEditor.setState({ player });
    return () => {
      useEditor.setState({ player: null, playing: false });
      void player.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    useEditor.getState().player?.setProject(project, files);
  }, [project, files]);

  useEffect(() => {
    const element = stageRef.current!;
    const observer = new ResizeObserver(() => setStage({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fit the canvas inside the stage, leaving room around it for the rotation handle.
  const { width, height } = project.canvas;
  const scale = Math.max(0, Math.min((stage.width - 48) / width, (stage.height - 72) / height));

  return (
    <section aria-label="Preview" className="flex min-h-0 min-w-0 flex-col bg-stage">
      <div ref={stageRef} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden">
        <div ref={hostRef} className="relative" style={{ width: Math.floor(width * scale), height: Math.floor(height * scale) }}>
          {!empty && scale > 0 && (tracking ? <TrackingOverlay /> : <CanvasOverlay scale={scale} />)}
        </div>
        {empty && (
          <p className="absolute max-w-xs text-center text-sm text-muted">
            Import media and add it to the timeline. Everything stays on this device.
          </p>
        )}
      </div>
      <Transport />
    </section>
  );
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  const project = useEditor((s) => s.project);
  const disabled = project.tracks.every((track) => track.clips.length === 0);

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-t border-border bg-panel px-3">
      <Timecode />
      <div className="flex items-center gap-0.5">
        <IconButton icon={SkipBackIcon} label="Previous edit" shortcut="↑" onClick={() => seekToEdit(-1)} disabled={disabled} />
        <IconButton icon={CaretLeftIcon} label="Previous frame" shortcut="←" onClick={() => stepFrames(-1)} disabled={disabled} />
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          title={`${playing ? "Pause" : "Play"} (Space)`}
          onClick={togglePlayback}
          disabled={disabled}
          className="press mx-1 grid size-9 place-items-center rounded-full bg-foreground text-stage hover:bg-[var(--clip-selected)] disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {playing ? <PauseIcon size={16} weight="fill" aria-hidden /> : <PlayIcon size={16} weight="fill" aria-hidden />}
        </button>
        <IconButton icon={CaretRightIcon} label="Next frame" shortcut="→" onClick={() => stepFrames(1)} disabled={disabled} />
        <IconButton icon={SkipForwardIcon} label="Next edit" shortcut="↓" onClick={() => seekToEdit(1)} disabled={disabled} />
      </div>
      <div className="w-44" />
    </div>
  );
}

/** Re-renders on every frame of playback, so it's kept apart from everything else. */
function Timecode() {
  const time = useEditor((s) => s.time);
  const project = useEditor((s) => s.project);
  const rate = project.canvas.frameRate;
  return (
    <p className="w-44 whitespace-nowrap font-mono text-xs tabular-nums">
      <output aria-label="Current time">{formatTimecode(time, rate)}</output>
      <span className="text-subtle"> / </span>
      <output aria-label="Duration" className="text-subtle">
        {formatTimecode(projectDuration(project), rate)}
      </output>
    </p>
  );
}
