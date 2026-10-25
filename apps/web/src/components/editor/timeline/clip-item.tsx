"use client";

import {
  type Asset,
  type Clip,
  clipDuration,
  clipEnd,
  type Edge,
  formatTimecode,
  FPS_30,
  type Id,
  sourceTimeAt,
  type Thumbnail,
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
  const left = timeToX(clip.start, zoom);
  const width = Math.max(2, timeToX(clipDuration(clip), zoom));
  const frozen = clip.freezeAt !== undefined;
  const color =
    asset.kind === "audio"
      ? "var(--clip-audio)"
      : frozen
        ? "var(--clip-freeze)"
        : asset.kind === "image"
          ? "var(--clip-image)"
          : "var(--clip-video)";
  const rate = asset.video?.frameRate ?? FPS_30;
  const silent = clip.volume === 0 && asset.audio !== undefined && !frozen;

  return (
    <button
      type="button"
      data-clip={clip.id}
      aria-pressed={selected}
      aria-label={`${asset.name}, ${formatTimecode(clip.start, rate)} to ${formatTimecode(clipEnd(clip), rate)}`}
      onPointerDown={(event) => onPointerDown(event, clip.id, null)}
      onClick={(event) => {
        // Pointer presses select in onPointerDown; this is Enter from the keyboard.
        if (event.detail === 0) select([clip.id], event.shiftKey ? "toggle" : "replace");
      }}
      className={`absolute top-1 overflow-hidden rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${locked ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing"}`}
      style={{ left, width, height: height - 9, background: color }}
    >
      {thumbnails && asset.kind !== "audio" && (
        <Filmstrip clip={clip} asset={asset} thumbnails={thumbnails} zoom={zoom} width={width} height={height - 9} />
      )}
      <span className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/55 to-transparent px-1.5 pb-2 pt-0.5 text-[11px] font-medium leading-tight text-foreground">
        {frozen && <SnowflakeIcon size={11} aria-hidden className="shrink-0" />}
        {silent && <SpeakerSimpleSlashIcon size={11} aria-hidden className="shrink-0" />}
        <span className="truncate">{asset.name}</span>
        {clip.speed !== 1 && <span className="shrink-0 rounded bg-black/50 px-1 font-mono text-[10px]">{clip.speed}×</span>}
      </span>
      {selected && <span aria-hidden className="pointer-events-none absolute inset-0 rounded border-2 border-[var(--clip-selected)]" />}
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

function nearest(thumbnails: Thumbnail[], time: number): Thumbnail {
  let best = thumbnails[0]!;
  for (const thumbnail of thumbnails) {
    if (Math.abs(thumbnail.time - time) < Math.abs(best.time - time)) best = thumbnail;
  }
  return best;
}
