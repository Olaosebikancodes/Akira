"use client";

import {
  type Clip,
  clearKeyframes,
  clipContains,
  type Easing,
  isKeyframed,
  KEYFRAME_PROPERTIES,
  keyframeAt,
  type KeyframeProperty,
  keyframeTimes,
  type Micros,
  type Project,
  setKeyframeEasing,
  toggleKeyframe,
} from "@akira/engine";
import { CaretLeftIcon, CaretRightIcon, DiamondIcon } from "@phosphor-icons/react";
import { commit, seek } from "./store";
import { Button, focusRing, IconButton, Section, SelectField } from "./ui";

const EASINGS: readonly { value: Easing; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" },
  { value: "ease-in-out", label: "Ease in and out" },
  { value: "hold", label: "Hold" },
];

/** Keyframe times this close to the playhead count as on it, for jumping between them. */
const NEAR: Micros = 1_000;

/**
 * The diamond beside a value. Filled when there's a keyframe on the
 * playhead; pressing it adds one there, or removes it.
 */
export function KeyframeButton({
  project,
  clip,
  property,
  label,
  time,
}: {
  project: Project;
  clip: Clip;
  property: KeyframeProperty;
  label: string;
  time: Micros;
}) {
  const keyed = isKeyframed(clip, property);
  const onPlayhead = keyed && keyframeAt(project, clip, property, time) !== undefined;
  const inside = clipContains(clip, time);
  return (
    <button
      type="button"
      aria-label={`${onPlayhead ? "Remove" : "Add"} ${label} keyframe`}
      aria-pressed={onPlayhead}
      title={inside ? `${onPlayhead ? "Remove" : "Add"} keyframe` : "Move the playhead over the clip to add keyframes"}
      disabled={!inside}
      onClick={() => commit((p) => toggleKeyframe(p, clip.id, property, time))}
      className={`press grid size-6 place-items-center rounded hover:bg-raised disabled:pointer-events-none disabled:opacity-35 ${keyed ? "text-accent" : "text-subtle hover:text-foreground"} ${focusRing}`}
    >
      <DiamondIcon size={12} weight={onPlayhead ? "fill" : "bold"} aria-hidden />
    </button>
  );
}

/** Jumping between keyframes, the easing of those on the playhead, and removing them all. */
export function KeyframesSection({ project, clip, time }: { project: Project; clip: Clip; time: Micros }) {
  const times = keyframeTimes(clip);
  const previous = times.findLast((t) => t < time - NEAR);
  const next = times.find((t) => t > time + NEAR);
  const here = KEYFRAME_PROPERTIES.filter((property) => keyframeAt(project, clip, property, time));
  const easing = here.length > 0 ? keyframeAt(project, clip, here[0]!, time)!.easing : null;

  return (
    <Section
      title="Keyframes"
      action={
        times.length > 0 && (
          <div className="flex">
            <IconButton icon={CaretLeftIcon} label="Previous keyframe" disabled={previous === undefined} onClick={() => seek(previous!)} />
            <IconButton icon={CaretRightIcon} label="Next keyframe" disabled={next === undefined} onClick={() => seek(next!)} />
          </div>
        )
      }
    >
      {times.length === 0 ? (
        <p className="text-xs text-subtle">
          Press the diamond beside a value to animate it. Once a value has keyframes, changing it anywhere on the clip adds
          another.
        </p>
      ) : (
        <>
          <p className="text-xs text-subtle">
            {times.length === 1 ? "1 keyframe" : `${times.length} keyframes`} on this clip
            {here.length > 0 ? ", one on the playhead." : "."}
          </p>
          {easing && (
            <SelectField
              label="Easing to next"
              value={easing}
              options={EASINGS}
              onChange={(value) => commit((p) => here.reduce((n, property) => setKeyframeEasing(n, clip.id, property, time, value), p))}
            />
          )}
          <Button onClick={() => commit((p) => clearKeyframes(p, clip.id, KEYFRAME_PROPERTIES, time))}>Remove all keyframes</Button>
        </>
      )}
    </Section>
  );
}
