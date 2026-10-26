"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { closeTour } from "./store";
import { Button, focusRing } from "./ui";

interface Step {
  /** What to highlight; the first and last steps stand alone in the middle. */
  target?: string;
  title: string;
  body: string;
  /** Where the card sits beside the highlight. */
  side: "right" | "left" | "top" | "bottom";
}

const STEPS: readonly Step[] = [
  {
    title: "Welcome to Akira",
    body: "A video editor that runs in your browser. Your footage is never uploaded: everything happens on this computer. This tour takes about a minute.",
    side: "bottom",
  },
  {
    target: '[aria-label="Library"]',
    title: "Bring in your media",
    body: "Import video, photos, music, fonts or captions, or drop files onto this panel, then press + on a file to add it. The Text and Effects tabs hold titles, transitions, effects and filters.",
    side: "right",
  },
  {
    target: '[aria-label="Timeline"]',
    title: "Arrange it on the timeline",
    body: "Clips on the bottom track sit end to end. Drag clips above it to layer stickers and text, drag their edges to trim, and hover a cut to add a transition. Press S to split at the playhead.",
    side: "top",
  },
  {
    target: '[aria-label="Preview"]',
    title: "Watch and place things",
    body: "Press Space to play. Drag a clip on the canvas to move it, its corners to resize and the circle to rotate. The phone button shows where TikTok's buttons will cover your video.",
    side: "left",
  },
  {
    target: '[aria-label="Inspector"]',
    title: "Fine-tune what's selected",
    body: "Position, colour, effects, enhance, speed and sound live here. Press the diamond beside a value to keyframe it, and change it somewhere else on the clip to animate it.",
    side: "left",
  },
  {
    target: "[data-tour=export]",
    title: "Export when you're done",
    body: "Save MP4 or WebM up to 4K, or use the TikTok preset to keep your video as sharp as it can be after upload.",
    side: "bottom",
  },
  {
    target: '[aria-label="All projects"]',
    title: "Your work saves itself",
    body: "Projects save in this browser as you edit. Find them all here, and download one as a .zip to back it up or move it to another computer.",
    side: "bottom",
  },
];

const CARD_WIDTH = 320;
const GAP = 14;
const MARGIN = 12;

/**
 * A short guided tour for first-timers: dims the editor, lights up one part
 * at a time and explains it. Escape or Skip ends it; it won't open by
 * itself again, but Help replays it.
 */
export function Tour() {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(180);
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  // Follow the highlighted part as the window changes size.
  useLayoutEffect(() => {
    const measure = () => {
      const element = step.target ? document.querySelector(step.target) : null;
      setRect(element ? element.getBoundingClientRect() : null);
      if (card.current) setCardHeight(card.current.offsetHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step.target]);

  // Each step's card takes focus, so screen readers read it and Tab reaches its buttons.
  useEffect(() => {
    card.current?.focus();
  }, [index]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeTour();
      // Nothing else in the editor reacts while the tour is open.
      event.stopPropagation();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const position = cardPosition(rect, step.side, cardHeight);

  return (
    <div className="fixed inset-0 z-[60]">
      {rect ? (
        // The highlight: a clear window with the rest of the screen dimmed around it.
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-accent transition-[top,left,width,height] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px oklch(0% 0 0 / 0.62)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/60" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="fixed flex flex-col outline-none gap-3 rounded-lg border border-border-strong bg-panel p-4 shadow-[0_20px_50px_oklch(0%_0_0/0.55)]"
        style={{ width: CARD_WIDTH, ...position }}
      >
        <p className="font-mono text-[11px] tabular-nums text-subtle">
          {index + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="text-[15px] font-semibold tracking-tight">
          {step.title}
        </h2>
        <p id="tour-body" className="text-[13px] leading-relaxed text-muted">
          {step.body}
        </p>
        {last && (
          <Link href="/docs" target="_blank" className={`w-fit rounded text-[13px] text-foreground underline underline-offset-4 ${focusRing}`}>
            Every feature and shortcut is in the docs
          </Link>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <button type="button" onClick={closeTour} className={`press rounded px-1.5 py-1 text-xs text-muted hover:text-foreground ${focusRing}`}>
            {last ? "Close" : "Skip tour"}
          </button>
          <div className="flex gap-2">
            {index > 0 && <Button onClick={() => setIndex(index - 1)}>Back</Button>}
            <Button variant="primary" onClick={() => (last ? closeTour() : setIndex(index + 1))}>
              {index === 0 ? "Show me around" : last ? "Start editing" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Puts the card beside the highlight, on the side asked for, kept inside the window. */
function cardPosition(rect: DOMRect | null, side: Step["side"], height: number): { top: number; left: number } {
  const width = window.innerWidth;
  const viewport = window.innerHeight;
  if (!rect) return { top: viewport / 2 - height / 2, left: width / 2 - CARD_WIDTH / 2 };
  let top: number;
  let left: number;
  switch (side) {
    case "right":
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.right + GAP;
      break;
    case "left":
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.left - GAP - CARD_WIDTH;
      break;
    case "top":
      top = rect.top - GAP - height;
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      break;
    case "bottom":
      top = rect.bottom + GAP;
      left = rect.right - CARD_WIDTH;
      break;
  }
  return {
    top: Math.min(viewport - height - MARGIN, Math.max(MARGIN, top)),
    left: Math.min(width - CARD_WIDTH - MARGIN, Math.max(MARGIN, left)),
  };
}
