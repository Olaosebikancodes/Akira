"use client";

import { FilmStripIcon, type Icon, IntersectIcon, SlidersHorizontalIcon, TextTIcon, XIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import { EffectsPanel } from "./effects-panel";
import { Inspector } from "./inspector";
import { MediaPanel } from "./media-panel";
import { Preview } from "./preview";
import { useEditor } from "./store";
import { TextPanel } from "./text-panel";
import { Timeline } from "./timeline/timeline";
import { TopBar } from "./top-bar";
import { focusRing } from "./ui";

type Sheet = "media" | "text" | "effects" | "edit";

const TOOLS: readonly { id: Sheet; label: string; icon: Icon }[] = [
  { id: "media", label: "Media", icon: FilmStripIcon },
  { id: "text", label: "Text", icon: TextTIcon },
  { id: "effects", label: "Effects", icon: IntersectIcon },
  { id: "edit", label: "Edit", icon: SlidersHorizontalIcon },
];

function clipCount(tracks: readonly { clips: readonly unknown[] }[]): number {
  return tracks.reduce((sum, track) => sum + track.clips.length, 0);
}

/**
 * The editor on a phone, laid out the way phone editors are: the preview on
 * top, the timeline under it, and tools along the bottom that open the
 * desktop's panels as a sheet over the timeline, leaving the preview and the
 * tools in view.
 */
export function MobileEditor({ opening }: { opening: boolean }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const selected = useEditor((s) => s.selection.length > 0);

  // After adding media the sheet gets out of the way; after adding text it opens the words to type.
  useEffect(
    () =>
      useEditor.subscribe((state, previous) => {
        if (clipCount(state.project.tracks) <= clipCount(previous.project.tracks)) return;
        setSheet((open) => (open === "media" ? null : open === "text" ? "edit" : open));
      }),
    [],
  );

  return (
    <main aria-busy={opening} className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <TopBar />
      {/* Grid cells stretch their child to fill them, which the preview and timeline need to size themselves. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        <Preview />
      </div>
      {/* A tool opens over the timeline, which grows to make room; the preview shrinks but stays whole. */}
      <div
        className={`relative grid shrink-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden border-t border-border ${sheet ? "h-[50dvh] min-h-72" : "h-[36dvh] min-h-48"}`}
      >
        <div inert={sheet !== null} className="grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
          <Timeline compact />
        </div>
        {sheet && (
          <BottomSheet title={TOOLS.find((tool) => tool.id === sheet)!.label} onClose={() => setSheet(null)}>
            {sheet === "media" && <MediaPanel />}
            {sheet === "text" && <TextPanel />}
            {sheet === "effects" && <EffectsPanel />}
            {sheet === "edit" && <Inspector />}
          </BottomSheet>
        )}
      </div>
      <nav aria-label="Tools" className="grid shrink-0 grid-cols-4 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)]">
        {TOOLS.map((tool) => {
          const Glyph = tool.icon;
          const active = sheet === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSheet(active ? null : tool.id)}
              className={`press relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-foreground" : "text-muted"} ${focusRing}`}
            >
              <Glyph size={20} weight={active ? "fill" : "regular"} aria-hidden />
              {tool.label}
              {/* A dot on Edit says a clip is selected and has settings to change. */}
              {tool.id === "edit" && selected && !active && <span aria-hidden className="absolute right-[calc(50%-18px)] top-2.5 size-1.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </nav>
      {opening && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
          <p className="text-sm text-muted">Opening project…</p>
        </div>
      )}
    </main>
  );
}

/** A panel that slides up over the timeline, above the tools. Escape or the close button puts it away. */
function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <section
      role="dialog"
      aria-label={title}
      className="absolute inset-0 z-40 flex flex-col rounded-t-xl border-t border-border-strong bg-panel motion-safe:animate-[sheet-up_220ms_var(--ease-out)]"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border pl-4 pr-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} className={`press grid size-9 place-items-center rounded-md text-muted hover:bg-raised ${focusRing}`}>
          <XIcon size={17} aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </section>
  );
}
