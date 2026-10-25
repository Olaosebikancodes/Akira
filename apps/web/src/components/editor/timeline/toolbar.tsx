"use client";

import { assetOf, clipAt, isStill, locateClip, mainTrack, wallClock } from "@akira/engine";
import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ArrowsOutLineHorizontalIcon,
  BookmarkSimpleIcon,
  CopySimpleIcon,
  MagnetStraightIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MicrophoneIcon,
  ScissorsIcon,
  SnowflakeIcon,
  StopIcon,
  SwapIcon,
  TrashIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { type ChangeEvent, useEffect, useId, useState } from "react";
import {
  deleteSelection,
  detachSelectedAudio,
  duplicateSelection,
  freezeAtPlayhead,
  replaceSelected,
  splitAtPlayhead,
  startVoiceover,
  stopVoiceover,
  toggleMarkerAtPlayhead,
  zoomToFit,
} from "../actions";
import { MAX_ZOOM, MIN_ZOOM, redo, setSnapping, setZoom, undo, useEditor } from "../store";
import { focusRing, IconButton } from "../ui";

export function TimelineToolbar({ viewWidth }: { viewWidth: number }) {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const zoom = useEditor((s) => s.zoom);
  const snapping = useEditor((s) => s.snapping);
  const replaceId = useId();

  // What the clip tools act on: the selection, or the main-track clip under the playhead.
  // Selecting just the id keeps this from re-rendering on every frame of playback.
  const project = useEditor((s) => s.project);
  const targetId = useEditor((s) => s.selection[0] ?? clipAt(mainTrack(s.project), s.time)?.id ?? null);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const recording = useEditor((s) => s.recording !== null);
  const target = targetId ? locateClip(project, targetId) : undefined;
  const targetAsset = target && assetOf(project, target.clip);
  const isMoving = target ? !isStill(project, target.clip) : false;
  const canFreeze = target?.track.kind === "video" && isMoving;
  const canDetach = target?.track.kind === "video" && isMoving && !!targetAsset?.audio && target.clip.volume > 0;

  function onReplaceChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void replaceSelected(file);
  }

  return (
    <div role="toolbar" aria-label="Timeline tools" className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <div className="flex items-center gap-0.5">
        <IconButton icon={ArrowUUpLeftIcon} label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo} />
        <IconButton icon={ArrowUUpRightIcon} label="Redo" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo} />
        <Divider />
        <IconButton icon={ScissorsIcon} label="Split" shortcut="S" onClick={splitAtPlayhead} disabled={!target} />
        <IconButton icon={TrashIcon} label="Delete" shortcut="Delete" onClick={() => deleteSelection(false)} disabled={!hasSelection} />
        <IconButton icon={CopySimpleIcon} label="Duplicate" shortcut="Ctrl+D" onClick={duplicateSelection} disabled={!target} />
        <IconButton icon={SnowflakeIcon} label="Freeze frame" shortcut="F" onClick={freezeAtPlayhead} disabled={!canFreeze} />
        <IconButton icon={WaveformIcon} label="Detach audio" onClick={detachSelectedAudio} disabled={!canDetach} />
        <input id={replaceId} type="file" accept="video/*,audio/*,image/*" className="peer sr-only" onChange={onReplaceChosen} disabled={!target} />
        <label
          htmlFor={replaceId}
          title="Replace clip"
          className={`press grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised hover:text-foreground peer-disabled:pointer-events-none peer-disabled:opacity-35 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring`}
        >
          <SwapIcon size={17} aria-hidden />
          <span className="sr-only">Replace clip</span>
        </label>
        <Divider />
        <IconButton icon={BookmarkSimpleIcon} label="Add or remove marker" shortcut="M" onClick={toggleMarkerAtPlayhead} />
        <Divider />
        {recording ? (
          <RecordingIndicator />
        ) : (
          <IconButton icon={MicrophoneIcon} label="Record voiceover" onClick={() => void startVoiceover()} />
        )}
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          icon={MagnetStraightIcon}
          label="Snapping"
          shortcut="N"
          onClick={() => setSnapping(!snapping)}
          active={snapping}
        />
        <Divider />
        <IconButton icon={MagnifyingGlassMinusIcon} label="Zoom out" shortcut="-" onClick={() => setZoom(zoom / 1.5)} />
        <input
          type="range"
          aria-label="Timeline zoom"
          className={`slider w-24 ${focusRing}`}
          min={Math.log(MIN_ZOOM)}
          max={Math.log(MAX_ZOOM)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(event) => setZoom(Math.exp(Number(event.target.value)))}
        />
        <IconButton icon={MagnifyingGlassPlusIcon} label="Zoom in" shortcut="=" onClick={() => setZoom(zoom * 1.5)} />
        <IconButton icon={ArrowsOutLineHorizontalIcon} label="Zoom to fit" shortcut="Shift+Z" onClick={() => zoomToFit(viewWidth)} />
      </div>
    </div>
  );
}

/** Shown while a voiceover records: elapsed time and the way to stop. */
function RecordingIndicator() {
  const startedAt = useEditor((s) => s.recording?.take.startedAt ?? 0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.max(0, wallClock() - startedAt)), 250);
    return () => clearInterval(timer);
  }, [startedAt]);

  const seconds = Math.floor(elapsed / 1000);
  return (
    <div className="flex items-center gap-2 pl-1" role="status" aria-label="Recording voiceover">
      <span aria-hidden className="size-2 rounded-full bg-accent motion-safe:animate-pulse" />
      <span className="font-mono text-xs tabular-nums text-foreground">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <IconButton icon={StopIcon} label="Stop recording" onClick={() => void stopVoiceover()} />
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}
