"use client";

import { clipEnd, followingClip, type Track } from "@akira/engine";
import { ArrowsLeftRightIcon, PlusIcon } from "@phosphor-icons/react";
import { applyTransitionAt, transitionLabel } from "../look";
import { select } from "../store";
import { timeToX } from "./layout";

/**
 * Marks every cut between touching clips on a video track: a badge across
 * the transition where there is one, and an add button on hover where there
 * isn't.
 */
export function TransitionMarks({ track, zoom, height }: { track: Track; zoom: number; height: number }) {
  if (track.kind !== "video" || track.locked) return null;
  const clipHeight = height - 9;

  return track.clips.map((clip) => {
    const next = followingClip(track, clip);
    if (!next) return null;
    const cut = timeToX(clipEnd(clip), zoom);
    const transition = clip.transition;
    const width = transition ? Math.max(16, timeToX(transition.duration, zoom)) : 16;
    const name = transition && transitionLabel(transition.kind);
    const label = transition ? `${name} transition, edit` : "Add transition";

    return (
      <button
        key={clip.id}
        type="button"
        aria-label={label}
        title={name || "Add transition"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => (transition ? select([clip.id]) : applyTransitionAt(clip.id, "Fade"))}
        className={`press absolute z-10 grid place-items-center rounded-[4px] outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring ${
          transition
            ? "border border-white/60 bg-black/55 text-foreground backdrop-blur-sm hover:bg-black/70"
            : "bg-accent text-accent-foreground opacity-0 hover:opacity-100 pointer-coarse:opacity-100"
        }`}
        style={{ left: cut - width / 2, width, top: 1 + clipHeight / 2 - 9, height: 18 }}
      >
        {transition ? <ArrowsLeftRightIcon size={12} weight="bold" aria-hidden /> : <PlusIcon size={11} weight="bold" aria-hidden />}
      </button>
    );
  });
}
