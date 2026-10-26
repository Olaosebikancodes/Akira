"use client";

import { type Asset, formatTimecode, FPS_30 } from "@akira/engine";
import { ImageSquareIcon, MusicNotesSimpleIcon, PaletteIcon, PlusIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { type ChangeEvent, type DragEvent, useId, useState } from "react";
import { addToTimeline } from "./actions";
import { Bitmap } from "./bitmap";
import { importFiles, useEditor } from "./store";
import { focusRing } from "./ui";

export const ASSET_DRAG_TYPE = "application/x-akira-asset";
const ACCEPT = "video/*,audio/*,image/*,.srt,.ttf,.otf,.woff,.woff2,.cube";

export function MediaPanel() {
  const assets = useEditor((s) => s.project.assets);
  const importing = useEditor((s) => s.importing);
  const [dropping, setDropping] = useState(false);
  const inputId = useId();
  // Reversed copies are Akira's own; they belong to the clips that use them.
  const list = Object.values(assets).filter((asset) => !asset.reverseOf);

  function onChosen(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) void importFiles(files);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDropping(false);
    const files = [...event.dataTransfer.files];
    if (files.length > 0) void importFiles(files);
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col bg-panel ${dropping ? "outline-2 -outline-offset-2 outline-ring" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <header className="flex h-11 shrink-0 items-center justify-between pl-4 pr-2">
        <p className="text-xs text-muted">{list.length === 1 ? "1 file" : `${list.length} files`}</p>
        <input id={inputId} type="file" accept={ACCEPT} multiple className="peer sr-only" onChange={onChosen} />
        <label
          htmlFor={inputId}
          className="press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-raised px-2.5 text-xs font-medium hover:bg-raised-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
        >
          <UploadSimpleIcon size={14} aria-hidden />
          Import
        </label>
      </header>

      {list.length === 0 && importing === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-muted">Drop video, audio, images, fonts, captions or LUTs here.</p>
          <p className="text-xs text-subtle">Files open on this device and are never uploaded.</p>
        </div>
      ) : (
        <ul className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto p-3">
          {list.map((asset) => (
            <MediaTile key={asset.id} asset={asset} />
          ))}
          {Array.from({ length: importing }, (_, i) => (
            <li key={`pending-${i}`} aria-label="Opening file…" className="flex flex-col gap-1.5">
              <div className="aspect-video animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
              <div className="h-3 w-2/3 rounded bg-raised" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaTile({ asset }: { asset: Asset }) {
  const thumbnail = useEditor((s) => s.thumbnails.get(asset.id)?.[0]);
  const Placeholder = asset.kind === "audio" ? MusicNotesSimpleIcon : ImageSquareIcon;

  if (asset.font) {
    // Fonts aren't placed on the timeline; text clips pick them by name.
    return (
      <li className="flex min-w-0 flex-col gap-1.5">
        <div
          className="grid aspect-video place-items-center rounded-md bg-raised text-2xl text-foreground"
          style={{ fontFamily: `"${asset.font.family}", sans-serif` }}
          aria-hidden
        >
          Aa
        </div>
        <p className="truncate text-xs text-muted" title={asset.name}>
          {asset.name}
        </p>
      </li>
    );
  }

  if (asset.lut) {
    // LUTs are applied to clips from the Effects tab or the inspector.
    return (
      <li className="flex min-w-0 flex-col gap-1.5">
        <div className="grid aspect-video place-items-center rounded-md bg-raised" aria-hidden>
          <PaletteIcon size={22} className="text-accent" />
        </div>
        <p className="truncate text-xs text-muted" title={asset.name}>
          {asset.name}
        </p>
      </li>
    );
  }

  return (
    <li
      className="group relative flex min-w-0 flex-col gap-1.5"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-raised">
        {thumbnail ? (
          <Bitmap image={thumbnail.image} className="size-full" />
        ) : (
          <Placeholder size={22} className="absolute inset-0 m-auto text-subtle" aria-hidden />
        )}
        {asset.duration > 0 && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] tabular-nums text-foreground">
            {formatTimecode(asset.duration, asset.video?.frameRate ?? FPS_30).slice(3, 8)}
          </span>
        )}
        <button
          type="button"
          aria-label={`Add ${asset.name} to timeline`}
          title="Add to timeline"
          onClick={() => addToTimeline(asset)}
          className={`press absolute right-1 top-1 grid size-6 place-items-center rounded-md bg-accent text-accent-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${focusRing}`}
        >
          <PlusIcon size={14} weight="bold" aria-hidden />
        </button>
      </div>
      <p className="truncate text-xs text-muted" title={asset.name}>
        {asset.name}
      </p>
    </li>
  );
}
