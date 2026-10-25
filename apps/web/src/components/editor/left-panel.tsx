"use client";

import { FilmStripIcon, type Icon, TextTIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { MediaPanel } from "./media-panel";
import { TextPanel } from "./text-panel";
import { focusRing } from "./ui";

const TABS = [
  { id: "media", label: "Media", icon: FilmStripIcon },
  { id: "text", label: "Text", icon: TextTIcon },
] as const satisfies readonly { id: string; label: string; icon: Icon }[];

type TabId = (typeof TABS)[number]["id"];

/** Media and Text, as tabs. Arrow keys move between tabs, as the ARIA tab pattern expects. */
export function LeftPanel() {
  const [active, setActive] = useState<TabId>("media");
  const baseId = useId();
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // Stop the editor's global shortcuts (frame stepping) from also handling the arrow.
    event.stopPropagation();
    const index = TABS.findIndex((tab) => tab.id === active);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setActive(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <section aria-label="Library" className="flex min-h-0 flex-col bg-panel">
      <div role="tablist" aria-label="Library" className="flex h-11 shrink-0 items-end gap-1 border-b border-border px-2" onKeyDown={onKeyDown}>
        {TABS.map((tab) => {
          const selected = tab.id === active;
          const Glyph = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
              }}
              type="button"
              role="tab"
              id={`${baseId}-${tab.id}-tab`}
              aria-selected={selected}
              aria-controls={`${baseId}-${tab.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium ${selected ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"} ${focusRing}`}
            >
              <Glyph size={15} aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-${active}-panel`}
        aria-labelledby={`${baseId}-${active}-tab`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {active === "media" ? <MediaPanel /> : <TextPanel />}
      </div>
    </section>
  );
}
