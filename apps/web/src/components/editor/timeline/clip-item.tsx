"use client";

import {
  type Asset,
  type Clip,
  clipDuration,
  clipGainAt,
  clipEnd,
  type Edge,
  formatTimecode,
  FPS_30,
  type Id,
  isSilent,
  keyframeTimes,
  peakBetween,
  sourceTimeAt,
  type Thumbnail,
  toSourceTime,
  type Waveform,
} from "@akira/engine";
import { SnowflakeIcon, SpeakerSimpleSlashIcon } from "@phosphor-icons/react";
import { memo, type PointerEvent, useEffect, useRef } from "react";
import { select, useEditor } from "../store";
import { timeToX, xToTime } from "./layout";

/** Canvas backing stores beyond this get huge; very long clips stretch their filmstrip instead. */
const MAX_FILMSTRIP_PIXELS = 8192;

interface ClipItemProps {
  clip: Clip;
  asset: Asset;
  zoom: number;
  height: number;
  selected: boolean;
  locked: boolean;
  onPointerDown: (event: PointerEvent, clipId: Id, edge: Edge | null) => void;
}

export const ClipItem = memo(function ClipItem({ clip, asset, zoom, height, selected, locked, onPointerDown }: ClipItemProps) {
  const thumbnails = useEditor((s) => s.thumbnails.get(asset.id));
  const waveform = useEditor((s) => s.waveforms.get(asset.id));
  const left = timeToX(clip.start, zoom);
  const width = Math.max(2, timeToX(clipDuration(clip), zoom));
  const frozen = clip.freezeAt !== undefined;
  const label = clip.text ? clip.text.content.split("\n")[0] || "Text" : asset.name;
  const color = clip.text
    ? "var(--clip-text)"
    : asset.kind === "audio"
      ? "var(--clip-audio)"
      : frozen
        ? "var(--clip-freeze)"
        : asset.kind === "image"
          ? "var(--clip-image)"
          : "var(--clip-video)";
  const rate = asset.video?.frameRate ?? FPS_30;
  const silent = isSilent(clip) && asset.audio !== undefined && !frozen;
  const clipHeight = height - 9;
  // Audio clips are all waveform; video clips with sound get a strip along the bottom.
  const waveHeight = asset.kind === "audio" ? clipHeight : Math.round(clipHeight * 0.32);

  return (
    <button
      type="button"
      data-clip={clip.id}
      aria-pressed={selected}
      aria-label={`${label}, ${formatTimecode(clip.start, rate)} to ${formatTimecode(clipEnd(clip), rate)}`}
      onPointerDown={(event) => onPointerDown(event, clip.id, null)}
      onClick={(event) => {
        // Pointer presses select in onPointerDown; this is Enter from the keyboard.
        if (event.detail === 0) select([clip.id], event.shiftKey ? "toggle" : "replace");
      }}
      className={`absolute top-1 overflow-hidden rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${locked ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing"}`}
      style={{ left, width, height: height - 9, background: color }}
    >
      {thumbnails && asset.kind !== "audio" && (
        <Filmstrip clip={clip} asset={asset} thumbnails={thumbnails} zoom={zoom} width={width} height={clipHeight} />
      )}
      {waveform && !frozen && <WaveformStrip clip={clip} waveform={waveform} zoom={zoom} width={width} height={waveHeight} />}
      <span className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/55 to-transparent px-1.5 pb-2 pt-0.5 text-[11px] font-medium leading-tight text-foreground">
        {frozen && <SnowflakeIcon size={11} aria-hidden className="shrink-0" />}
        {silent && <SpeakerSimpleSlashIcon size={11} aria-hidden className="shrink-0" />}
        <span className="truncate">{label}</span>
        {clip.speed !== 1 && <span className="shrink-0 rounded bg-black/50 px-1 font-mono text-[10px]">{clip.speed}×</span>}
      </span>
      {selected && <span aria-hidden className="pointer-events-none absolute inset-0 rounded border-2 border-[var(--clip-selected)]" />}
      {selected &&
        keyframeTimes(clip).map((time) => (
          // Where the selected clip's keyframes are; the inspector jumps between them.
          <span
            key={time}
            aria-hidden
            data-keyframe
            className="pointer-events-none absolute bottom-1 size-2 -translate-x-1/2 rotate-45 border border-black/60 bg-[var(--clip-selected)]"
            style={{ left: timeToX(time - clip.start, zoom) }}
          />
        ))}
      {!locked && (
        <>
          <span
            aria-hidden
            onPointerDown={(event) => {
              // The handle sits inside the clip; without this the clip would start a move.
              event.stopPropagation();
              onPointerDown(event, clip.id, "start");
            }}
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-[var(--clip-selected)] opacity-0 hover:opacity-80"
          />
          <span
            aria-hidden
            onPointerDown={(event) => {
              event.stopPropagation();
              onPointerDown(event, clip.id, "end");
            }}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-[var(--clip-selected)] opacity-0 hover:opacity-80"
          />
        </>
      )}
    </button>
  );
});

/**
 * Tiles of thumbnails across the clip, each showing the source frame at that
 * point in the clip, so trims and speed changes show the right pictures.
 */
function Filmstrip({
  clip,
  asset,
  thumbnails,
  zoom,
  width,
  height,
}: {
  clip: Clip;
  asset: Asset;
  thumbnails: Thumbnail[];
  zoom: number;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ratio = devicePixelRatio;
    const pixelWidth = Math.min(MAX_FILMSTRIP_PIXELS, Math.round(width * ratio));
    const pixelHeight = Math.round(height * ratio);
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext("2d")!;
    const first = thumbnails[0]!.image;
    const tileWidth = (first.width / first.height) * pixelHeight;
    const stretch = pixelWidth / (width * ratio);

    for (let x = 0; x < pixelWidth; x += tileWidth) {
      const offset = xToTime((x + tileWidth / 2) / ratio / stretch, zoom);
      const sourceTime = clip.freezeAt ?? (asset.kind === "image" ? 0 : sourceTimeAt(clip, clip.start + offset));
      context.drawImage(nearest(thumbnails, sourceTime).image, x, 0, tileWidth, pixelHeight);
    }
  }, [clip, asset.kind, thumbnails, zoom, width, height]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full opacity-80" />;
}

/**
 * The clip's sound as a waveform, each column scaled by the clip's gain at
 * that moment, so volume and fades show up as the shape of the wave. Heights
 * use the square root of the level, as many audio editors do, so quiet
 * speech is still visible.
 */
function WaveformStrip({
  clip,
  waveform,
  zoom,
  width,
  height,
}: {
  clip: Clip;
  waveform: Waveform;
  zoom: number;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ratio = devicePixelRatio;
    const pixelWidth = Math.min(MAX_FILMSTRIP_PIXELS, Math.max(1, Math.round(width * ratio)));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(canvas).color;
    const stretch = pixelWidth / (width * ratio);
    const column = Math.max(1, Math.round(ratio));
    for (let x = 0; x < pixelWidth; x += column) {
      const from = clip.start + xToTime(x / ratio / stretch, zoom);
      const to = clip.start + xToTime((x + column) / ratio / stretch, zoom);
      const peak = peakBetween(waveform, toSourceTime(clip, from), toSourceTime(clip, to)) * clipGainAt(clip, from);
      const bar = Math.max(column, Math.sqrt(Math.min(1, peak)) * pixelHeight);
      context.fillRect(x, pixelHeight - bar, column, bar);
    }
  }, [clip, waveform, zoom, width, height]);

  return (
    <canvas
      ref={ref}
      data-waveform
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 w-full text-waveform"
      style={{ height }}
    />
  );
}

function nearest(thumbnails: Thumbnail[], time: number): Thumbnail {
  let best = thumbnails[0]!;
  for (const thumbnail of thumbnails) {
    if (Math.abs(thumbnail.time - time) < Math.abs(best.time - time)) best = thumbnail;
  }
  return best;
}
