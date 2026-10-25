import { frameToMicros, type Micros } from "../time";
import type { Cue } from "./captions";
import { createId, createTextClip, createTrack } from "./create";
import {
  type Adjustments,
  type Asset,
  type AudioFilters,
  type BlendMode,
  type ChromaKey,
  CAPTION_POSITION,
  CAPTION_STYLE,
  type Clip,
  type ClipAnimation,
  type ClipTransition,
  type Effect,
  type Easing,
  type Enhance,
  type Crop,
  IDENTITY_TRANSFORM,
  type Id,
  type Keyframe,
  type KeyframeProperty,
  type Mask,
  NEUTRAL_ADJUSTMENTS,
  NO_ENHANCE,
  type Project,
  type Track,
  type TextStyle,
  type TrackKind,
  type Transform,
} from "./model";
import {
  isKeyframed,
  keyframeClock,
  propertyAt,
  shiftKeyframes,
  isSilent,
  transformAt,
  withoutKeyframes,
} from "./keyframes";
import { assetOf, followingClip, isStill, locateClip } from "./query";
import { clipDuration, clipEnd, sourceTimeAt, toSourceTime, toTimelineTime } from "./timing";

/*
 * Every edit is a pure function from one project to the next. The editor's
 * undo history is just the list of earlier projects, and each function here
 * can be unit-tested without a browser.
 *
 * Rules the edits keep:
 * - The main track (tracks[0]) is magnetic: its clips sit end to end from
 *   zero, so inserting, deleting or resizing a clip ripples the rest.
 * - Clips on other tracks never overlap. A clip dropped onto an occupied
 *   stretch goes onto a new track instead, as in CapCut.
 * - Locked tracks don't change, and no clip gets shorter than one frame.
 */

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const DEFAULT_FREEZE_DURATION: Micros = 3_000_000;

/** Where a clip should go: an existing track, or a new one when omitted. */
export interface Placement {
  trackId?: Id;
  /** Timeline time for the clip's start. On the main track, the nearest gap between clips wins. */
  time: Micros;
}

export function minClipDuration(project: Project): Micros {
  return frameToMicros(1, project.canvas.frameRate);
}

/**
 * Restores the invariants after an edit: the main track is packed from
 * zero in its current order, other tracks are sorted by start, fades and
 * animations fit inside their clips, and empty tracks other than the main
 * track are removed.
 */
export function normalize(project: Project): Project {
  const tracks = project.tracks
    .map((track, index) => fitTimings(index === 0 ? packTrack(track) : sortTrack(track)))
    .filter((track, index) => index === 0 || track.clips.length > 0);
  return { ...project, tracks };
}

export function insertClip(project: Project, clip: Clip, placement: Placement): Project {
  const kind = trackKindFor(project, clip);
  const index = placement.trackId
    ? project.tracks.findIndex((track) => track.id === placement.trackId)
    : -1;
  const target = index >= 0 ? project.tracks[index]! : undefined;

  if (target && target.kind === kind && !target.locked) {
    if (index === 0) return normalize(insertIntoMain(project, clip, placement.time));
    return normalize(placeOnTrack(project, index, { ...clip, start: Math.max(0, placement.time) }));
  }
  return normalize(addTrackWith(project, kind, { ...clip, start: Math.max(0, placement.time) }, project.tracks.length));
}

/** Moves a clip, keeping its id. Same rules as inserting it fresh. */
export function moveClip(project: Project, clipId: Id, placement: Placement): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  if (found.trackIndex === 0 && placement.trackId === found.track.id) {
    return normalize(reorderMain(project, found.clip, placement.time));
  }
  const without = updateTrackAt(project, found.trackIndex, (track) => ({
    ...track,
    clips: track.clips.filter((c) => c.id !== clipId),
  }));
  return insertClip(without, found.clip, placement);
}

export type Edge = "start" | "end";

/** Drags one edge of a clip to `time`, limited by its source, its neighbours and one frame. */
export function trimClip(project: Project, clipId: Id, edge: Edge, time: Micros): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, track, trackIndex } = found;
  const minimum = minClipDuration(project);
  const still = isStill(project, clip);
  const asset = assetOf(project, clip);
  const onMain = trackIndex === 0;
  const start = clip.start;
  const end = clipEnd(clip);

  let next: Clip;
  if (edge === "start") {
    let lowest = onMain ? -Infinity : Math.max(0, previousEnd(track, clip));
    if (!still) lowest = Math.max(lowest, toTimelineTime(clip, asset.start));
    const newStart = Math.round(clamp(time, lowest, end - minimum));
    // A still's keyframe clock starts at its start, so its keyframes shift to stay put.
    next = still
      ? shiftKeyframes({ ...clip, start: newStart, sourceIn: 0, sourceOut: end - newStart }, start - newStart)
      : { ...clip, start: newStart, sourceIn: toSourceTime(clip, newStart) };
  } else {
    let highest = onMain ? Infinity : nextStart(track, clip);
    if (!still) highest = Math.min(highest, toTimelineTime(clip, asset.start + asset.duration));
    const newEnd = Math.round(clamp(time, start + minimum, highest));
    next = still
      ? { ...clip, sourceIn: 0, sourceOut: newEnd - start }
      : { ...clip, sourceOut: toSourceTime(clip, newEnd) };
  }
  return normalize(replaceClip(project, trackIndex, next));
}

export interface SplitResult {
  project: Project;
  /** Id of the right-hand half, or null when the split wasn't possible. */
  rightId: Id | null;
}

/** Cuts a clip in two at `time`. Both halves must be at least a frame long. */
export function splitClip(project: Project, clipId: Id, time: Micros): SplitResult {
  const found = locateClip(project, clipId);
  const minimum = minClipDuration(project);
  if (!found || found.track.locked) return { project, rightId: null };
  const { clip, trackIndex } = found;
  if (time - clip.start < minimum || clipEnd(clip) - time < minimum) return { project, rightId: null };

  const [left, right] = cutAt(project, clip, time);
  const tracks = project.tracks.map((track, index) =>
    index === trackIndex
      ? { ...track, clips: track.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) }
      : track,
  );
  return { project: normalize({ ...project, tracks }), rightId: right.id };
}

/**
 * Removes clips. The main track always closes the gap; with `ripple`, other
 * tracks close theirs too by pulling later clips on the same track back.
 */
export function deleteClips(project: Project, clipIds: readonly Id[], ripple = false): Project {
  const ids = new Set(clipIds);
  const tracks = project.tracks.map((track) => {
    if (track.locked || !track.clips.some((clip) => ids.has(clip.id))) return track;
    if (!ripple) return { ...track, clips: track.clips.filter((clip) => !ids.has(clip.id)) };

    const kept: Clip[] = [];
    let shift = 0;
    for (const clip of [...track.clips].sort(byStart)) {
      if (ids.has(clip.id)) shift += clipDuration(clip);
      else kept.push(shift ? { ...clip, start: clip.start - shift } : clip);
    }
    return { ...track, clips: kept };
  });
  return normalize({ ...project, tracks });
}

export interface DuplicateResult {
  project: Project;
  newIds: Id[];
}

/** Copies each clip to just after itself: next in line on the main track, or the nearest free spot. */
export function duplicateClips(project: Project, clipIds: readonly Id[]): DuplicateResult {
  let next = project;
  const newIds: Id[] = [];
  for (const id of clipIds) {
    const found = locateClip(next, id);
    if (!found || found.track.locked) continue;
    const copy: Clip = { ...found.clip, id: createId() };
    newIds.push(copy.id);
    next =
      found.trackIndex === 0
        ? normalize(insertIntoMainAfter(next, copy, id))
        : normalize(placeOnTrack(next, found.trackIndex, { ...copy, start: clipEnd(found.clip) }));
  }
  return { project: next, newIds };
}

/** Swaps the media a clip shows while keeping its position, length, look and volume. */
export function replaceClipAsset(project: Project, clipId: Id, asset: Asset): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, track, trackIndex } = found;
  if (kindForAsset(asset) !== track.kind) return project;

  const length = clipDuration(clip);
  let next: Clip;
  if (asset.kind === "font" || asset.kind === "text") return project;
  if (asset.kind === "image") {
    next = { ...clip, assetId: asset.id, speed: 1, sourceIn: 0, sourceOut: length, freezeAt: undefined, text: undefined };
  } else {
    const speed = isStill(project, clip) ? 1 : clip.speed;
    const sourceOut = Math.min(asset.start + Math.round(length * speed), asset.start + asset.duration);
    next = { ...clip, assetId: asset.id, speed, sourceIn: asset.start, sourceOut, freezeAt: undefined, text: undefined };
  }
  if (trackIndex !== 0) {
    // A longer clip mustn't run into the next one on its track.
    next = { ...next, sourceOut: Math.min(next.sourceOut, toSourceTime(next, nextStart(track, clip))) };
  }
  return normalize(replaceClip(project, trackIndex, next));
}

export interface FreezeResult {
  project: Project;
  freezeId: Id | null;
}

/**
 * Holds the frame at `time` for `duration`, pushing everything after it
 * later. Only works on moving video; stills are already frozen.
 */
export function freezeFrame(
  project: Project,
  clipId: Id,
  time: Micros,
  duration: Micros = DEFAULT_FREEZE_DURATION,
): FreezeResult {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked || found.track.kind !== "video") return { project, freezeId: null };
  const { clip, trackIndex } = found;
  if (isStill(project, clip) || time < clip.start || time >= clipEnd(clip)) {
    return { project, freezeId: null };
  }

  // Freeze at the clip edge rather than leave a sliver shorter than a frame.
  const minimum = minClipDuration(project);
  const end = clipEnd(clip);
  const at = time - clip.start < minimum ? clip.start : end - time < minimum ? end : time;
  const freeze: Clip = {
    ...clip,
    id: createId(),
    start: at,
    speed: 1,
    volume: 0,
    sourceIn: 0,
    sourceOut: duration,
    freezeAt: sourceTimeAt(clip, time),
    // The frozen picture holds the clip's look at that moment.
    transform: transformAt(clip, time),
    keyframes: undefined,
  };
  let pieces: Clip[];
  if (at === clip.start) pieces = [freeze, clip];
  else if (at === end) pieces = [clip, freeze];
  else {
    const [left, right] = cutAt(project, clip, at);
    pieces = [left, freeze, right];
  }

  const tracks = project.tracks.map((track, index) => {
    if (index !== trackIndex) return track;
    const clips = track.clips.flatMap((c) => (c.id === clip.id ? pieces : [c]));
    if (index === 0) return { ...track, clips };
    // Off the main track, everything from the freeze onwards moves right to make room.
    return {
      ...track,
      clips: clips.map((c) => (c.id !== freeze.id && c.start >= at ? { ...c, start: c.start + duration } : c)),
    };
  });
  return { project: normalize({ ...project, tracks }), freezeId: freeze.id };
}

export interface DetachResult {
  project: Project;
  audioClipId: Id | null;
}

/** Moves a video clip's sound onto an audio track and silences the video. */
export function detachAudio(project: Project, clipId: Id): DetachResult {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked || found.track.kind !== "video") return { project, audioClipId: null };
  const { clip, trackIndex } = found;
  if (isSilent(clip) || isStill(project, clip) || !assetOf(project, clip).audio) {
    return { project, audioClipId: null };
  }

  // Volume keyframes go with the sound; the picture keeps the rest.
  const audioClip: Clip = {
    ...withoutKeyframes(clip, ["x", "y", "scale", "rotation", "opacity"]),
    id: createId(),
    transform: IDENTITY_TRANSFORM,
  };
  const silenced = replaceClip(project, trackIndex, { ...withoutKeyframes(clip, ["volume"]), volume: 0 });
  const free = silenced.tracks.findIndex(
    (track) => track.kind === "audio" && !track.locked && fits(track, audioClip.start, clipEnd(audioClip)),
  );
  const next =
    free >= 0
      ? updateTrackAt(silenced, free, (track) => ({ ...track, clips: [...track.clips, audioClip] }))
      : addTrackWith(silenced, "audio", audioClip, silenced.tracks.length);
  return { project: normalize(next), audioClipId: audioClip.id };
}

/** Changes playback speed, keeping the clip's start. Later clips on its track move to make room. */
export function setClipSpeed(project: Project, clipId: Id, speed: number): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked || isStill(project, found.clip)) return project;
  const { clip, track, trackIndex } = found;
  const next = { ...clip, speed: clamp(speed, MIN_SPEED, MAX_SPEED) };
  let updated = replaceClip(project, trackIndex, next);

  if (trackIndex !== 0) {
    const overlap = clipEnd(next) - nextStart(track, clip);
    if (overlap > 0) {
      updated = updateTrackAt(updated, trackIndex, (t) => ({
        ...t,
        clips: t.clips.map((c) => (c.start > clip.start ? { ...c, start: c.start + overlap } : c)),
      }));
    }
  }
  return normalize(updated);
}

export interface ClipLook {
  transform?: Partial<Transform>;
  crop?: Partial<Crop>;
  volume?: number;
  adjust?: Partial<Adjustments>;
  /** null removes the LUT. */
  lut?: { assetId: Id; intensity: number } | null;
  effects?: Effect[];
  blend?: BlendMode;
  /** null removes the mask. */
  mask?: Partial<Mask> | null;
  /** null turns keying off. */
  chromaKey?: Partial<ChromaKey> | null;
  enhance?: Partial<Enhance>;
}

/** Updates how a clip looks or sounds. Doesn't move it in time. Values are kept in range. */
export function updateClipLook(project: Project, clipId: Id, look: ClipLook): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, trackIndex } = found;
  const next: Clip = {
    ...clip,
    transform: look.transform ? { ...clip.transform, ...look.transform } : clip.transform,
    crop: look.crop ? clampCrop({ ...clip.crop, ...look.crop }) : clip.crop,
    volume: look.volume === undefined ? clip.volume : Math.max(0, look.volume),
  };
  if (look.adjust) next.adjust = clampAdjustments({ ...NEUTRAL_ADJUSTMENTS, ...clip.adjust, ...look.adjust });
  if (look.lut !== undefined) next.lut = look.lut ? { ...look.lut, intensity: clamp(look.lut.intensity, 0, 1) } : undefined;
  if (look.effects) next.effects = look.effects.map((effect) => ({ ...effect, amount: clamp(effect.amount, 0, 1) }));
  if (look.blend) next.blend = look.blend;
  if (look.mask !== undefined) next.mask = look.mask ? clampMask({ ...DEFAULT_MASK, ...clip.mask, ...look.mask }) : undefined;
  if (look.chromaKey !== undefined) {
    next.chromaKey = look.chromaKey ? clampKey({ ...DEFAULT_CHROMA_KEY, ...clip.chromaKey, ...look.chromaKey }) : undefined;
  }
  if (look.enhance) next.enhance = clampEnhance({ ...NO_ENHANCE, ...clip.enhance, ...look.enhance });
  return replaceClip(project, trackIndex, next);
}

/** A mask's starting shape: a centred circle with a soft edge. */
export const DEFAULT_MASK: Mask = {
  shape: "circle",
  x: 0,
  y: 0,
  width: 0.6,
  height: 0.6,
  rotation: 0,
  feather: 0.1,
  invert: false,
};

/** Keying starts on green screen, the usual choice. */
export const DEFAULT_CHROMA_KEY: ChromaKey = { color: "#00ff00", tolerance: 0.35, softness: 0.15, spill: 0.5 };

export const MIN_TRANSITION: Micros = 100_000;

/**
 * Puts a transition between a clip and the next one on its track, or
 * removes it with null. The two must touch, and the transition is limited
 * to the shorter of them.
 */
export function setTransition(project: Project, clipId: Id, transition: ClipTransition | null): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, track, trackIndex } = found;
  if (!transition) return replaceClip(project, trackIndex, { ...clip, transition: undefined });
  const next = followingClip(track, clip);
  if (!next) return project;
  const duration = clamp(transition.duration, MIN_TRANSITION, Math.min(clipDuration(clip), clipDuration(next)));
  return replaceClip(project, trackIndex, { ...clip, transition: { ...transition, duration } });
}

/** Values for keyframable properties, by property. */
export type PropertyValues = Partial<Record<KeyframeProperty, number>>;

/**
 * Sets how a clip looks or sounds at `time`. Keyframed properties get a
 * keyframe there, added or updated; the others change the clip's own
 * value, so they change for its whole length.
 */
export function setValuesAt(project: Project, clipId: Id, time: Micros, values: PropertyValues): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  let clip = found.clip;
  for (const [property, raw] of Object.entries(values) as [KeyframeProperty, number][]) {
    const value = clampProperty(property, raw);
    if (isKeyframed(clip, property)) clip = withKeyframe(project, clip, property, time, value);
    else if (property === "volume") clip = { ...clip, volume: value };
    else clip = { ...clip, transform: { ...clip.transform, [property]: value } };
  }
  return replaceClip(project, found.trackIndex, clip);
}

/**
 * Adds a keyframe at `time` holding the property's current value, or
 * removes the one already there. When the last one goes, the property stops
 * changing and keeps that keyframe's value.
 */
export function toggleKeyframe(project: Project, clipId: Id, property: KeyframeProperty, time: Micros): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, trackIndex } = found;
  const existing = keyframeAt(project, clip, property, time);
  if (!existing) return replaceClip(project, trackIndex, withKeyframe(project, clip, property, time, propertyAt(clip, property, time)));

  const rest = clip.keyframes![property]!.filter((k) => k !== existing);
  if (rest.length > 0) return replaceClip(project, trackIndex, { ...clip, keyframes: { ...clip.keyframes, [property]: rest } });
  const still = withoutKeyframes(clip, [property]);
  const settled =
    property === "volume" ? { ...still, volume: existing.value } : { ...still, transform: { ...still.transform, [property]: existing.value } };
  return replaceClip(project, trackIndex, settled);
}

/** Stops properties changing over the clip, keeping the values they have at `time`. */
export function clearKeyframes(project: Project, clipId: Id, properties: readonly KeyframeProperty[], time: Micros): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked || !found.clip.keyframes) return project;
  let clip = found.clip;
  for (const property of properties) {
    if (!isKeyframed(clip, property)) continue;
    const value = propertyAt(clip, property, time);
    clip = withoutKeyframes(clip, [property]);
    clip = property === "volume" ? { ...clip, volume: value } : { ...clip, transform: { ...clip.transform, [property]: value } };
  }
  return replaceClip(project, found.trackIndex, clip);
}

/** Changes how the value moves from the keyframe at `time` to the next one. */
export function setKeyframeEasing(project: Project, clipId: Id, property: KeyframeProperty, time: Micros, easing: Easing): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, trackIndex } = found;
  const existing = keyframeAt(project, clip, property, time);
  if (!existing) return project;
  const list = clip.keyframes![property]!.map((k) => (k === existing ? { ...k, easing } : k));
  return replaceClip(project, trackIndex, { ...clip, keyframes: { ...clip.keyframes, [property]: list } });
}

/** The keyframe on the playhead, within half a frame either side. */
export function keyframeAt(project: Project, clip: Clip, property: KeyframeProperty, time: Micros): Keyframe | undefined {
  const at = clockInside(clip, time);
  const tolerance = (frameToMicros(1, project.canvas.frameRate) * clip.speed) / 2;
  return clip.keyframes?.[property]?.find((k) => Math.abs(k.time - at) <= tolerance);
}

function withKeyframe(project: Project, clip: Clip, property: KeyframeProperty, time: Micros, value: number): Clip {
  const list = clip.keyframes?.[property] ?? [];
  const existing = keyframeAt(project, clip, property, time);
  const next = existing
    ? list.map((k) => (k === existing ? { ...k, value } : k))
    : [...list, { time: clockInside(clip, time), value, easing: "linear" as const }].sort((a, b) => a.time - b.time);
  return { ...clip, keyframes: { ...clip.keyframes, [property]: next } };
}

/** The keyframe clock at `time`, kept within the clip. */
function clockInside(clip: Clip, time: Micros): Micros {
  return keyframeClock(clip, Math.min(Math.max(time, clip.start), clipEnd(clip) - 1));
}

function clampProperty(property: KeyframeProperty, value: number): number {
  if (property === "opacity") return clamp(value, 0, 1);
  if (property === "scale") return Math.max(0.01, value);
  if (property === "volume") return Math.max(0, value);
  return value;
}

/**
 * Turns a clip a quarter turn clockwise, keeping the angle in (-180, 180].
 * If its rotation is keyframed, this sets a keyframe at `time`.
 */
export function rotateClip90(project: Project, clipId: Id, time?: Micros): Project {
  const clip = locateClip(project, clipId)?.clip;
  if (!clip) return project;
  const at = time ?? clip.start;
  return setValuesAt(project, clipId, at, { rotation: normalizeAngle(propertyAt(clip, "rotation", at) + 90) });
}

export function flipClip(project: Project, clipId: Id, axis: "x" | "y"): Project {
  const clip = locateClip(project, clipId)?.clip;
  if (!clip) return project;
  const transform = axis === "x" ? { flipX: !clip.transform.flipX } : { flipY: !clip.transform.flipY };
  return updateClipLook(project, clipId, { transform });
}

/**
 * The keyboard alternative to dragging. On the main track a clip swaps
 * places with its neighbour; elsewhere it moves by `frames`, stopping at
 * its neighbours and at zero.
 */
export function nudgeClip(project: Project, clipId: Id, frames: number): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked || frames === 0) return project;
  const { clip, track, trackIndex } = found;

  if (trackIndex === 0) {
    const order = track.clips.map((c) => c.id);
    const from = order.indexOf(clip.id);
    const to = clamp(from + Math.sign(frames), 0, order.length - 1);
    if (to === from) return project;
    const clips = [...track.clips];
    [clips[from], clips[to]] = [clips[to]!, clips[from]!];
    return normalize(updateTrackAt(project, 0, (t) => ({ ...t, clips })));
  }

  const delta = frameToMicros(Math.abs(frames), project.canvas.frameRate) * Math.sign(frames);
  const length = clipDuration(clip);
  const start = clamp(clip.start + delta, Math.max(0, previousEnd(track, clip)), nextStart(track, clip) - length);
  return normalize(replaceClip(project, trackIndex, { ...clip, start }));
}

export function addMarker(project: Project, time: Micros): Project {
  if (project.markers.some((marker) => marker.time === time)) return project;
  const markers = [...project.markers, { id: createId(), time }].sort((a, b) => a.time - b.time);
  return { ...project, markers };
}

export function removeMarker(project: Project, markerId: Id): Project {
  return { ...project, markers: project.markers.filter((marker) => marker.id !== markerId) };
}

/** Sets how long a clip's sound takes to fade in and out. Fades are limited to the clip's length. */
export function setClipFades(project: Project, clipId: Id, fades: { fadeIn?: Micros; fadeOut?: Micros }): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, trackIndex } = found;
  const fadeIn = Math.max(0, Math.round(fades.fadeIn ?? clip.fadeIn));
  const fadeOut = Math.max(0, Math.round(fades.fadeOut ?? clip.fadeOut));
  // Whichever fade is being set gives way to the other, so dragging one never moves both.
  const length = clipDuration(clip);
  const next =
    fades.fadeIn !== undefined
      ? { fadeIn: Math.min(fadeIn, length - Math.min(fadeOut, length)), fadeOut: Math.min(fadeOut, length) }
      : { fadeOut: Math.min(fadeOut, length - Math.min(fadeIn, length)), fadeIn: Math.min(fadeIn, length) };
  return replaceClip(project, trackIndex, { ...clip, ...next });
}

export function setAudioFilters(project: Project, clipId: Id, filters: Partial<AudioFilters>): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, trackIndex } = found;
  const audioFilters = { ...clip.audioFilters, ...filters };
  audioFilters.denoise = clamp(audioFilters.denoise, 0, 1);
  return replaceClip(project, trackIndex, { ...clip, audioFilters });
}

/** Changes what a text clip says or how it looks. Style changes merge into the current style. */
export function updateText(project: Project, clipId: Id, change: { content?: string; style?: Partial<TextStyle> }): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked || !found.clip.text) return project;
  const { clip, trackIndex } = found;
  const text = {
    content: change.content ?? clip.text!.content,
    style: { ...clip.text!.style, ...change.style },
  };
  text.style.size = clamp(text.style.size, 0.01, 0.5);
  return replaceClip(project, trackIndex, { ...clip, text });
}

/** Sets a clip's in, out or loop animation; pass null to remove one. */
export function setClipAnimation(project: Project, clipId: Id, change: Partial<ClipAnimation>): Project {
  const found = locateClip(project, clipId);
  if (!found || found.track.locked) return project;
  const { clip, trackIndex } = found;
  const animation = { in: null, out: null, loop: null, ...clip.animation, ...change };
  return normalize(replaceClip(project, trackIndex, { ...clip, animation }));
}

export interface CaptionsResult {
  project: Project;
  clipIds: Id[];
}

/** Adds one caption clip per cue on a new track above the others, in the caption style. */
export function addCaptions(project: Project, cues: readonly Cue[], style: TextStyle = CAPTION_STYLE): CaptionsResult {
  if (cues.length === 0) return { project, clipIds: [] };
  let next: Project = { ...project, tracks: [...project.tracks, createTrack("video")] };
  const trackIndex = next.tracks.length - 1;
  const clipIds: Id[] = [];
  for (const cue of cues) {
    const clip = createTextClip(cue.start, { content: cue.text, style }, cue.end - cue.start, CAPTION_POSITION);
    clipIds.push(clip.id);
    // Overlapping cues go onto a track of their own rather than colliding.
    next = placeOnTrack(next, trackIndex, clip);
  }
  return { project: normalize(next), clipIds };
}

export type TrackFlag = "muted" | "solo" | "hidden" | "locked";

export function setTrackFlag(project: Project, trackId: Id, flag: TrackFlag, value: boolean): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => (track.id === trackId ? { ...track, [flag]: value } : track)),
  };
}

// Helpers

function kindForAsset(asset: Asset): TrackKind {
  return asset.kind === "audio" ? "audio" : "video";
}

function trackKindFor(project: Project, clip: Clip): TrackKind {
  return kindForAsset(assetOf(project, clip));
}

/** Splits a clip into two pieces at `time`; the right piece gets a new id. */
function cutAt(project: Project, clip: Clip, time: Micros): [Clip, Clip] {
  // The left piece keeps the fade-in and the right the fade-out, so a cut
  // never dips; the transition into the next clip stays at the right end.
  if (isStill(project, clip)) {
    return [
      { ...clip, sourceIn: 0, sourceOut: time - clip.start, fadeOut: 0, transition: undefined },
      shiftKeyframes(
        { ...clip, id: createId(), start: time, sourceIn: 0, sourceOut: clipEnd(clip) - time, fadeIn: 0 },
        clip.start - time,
      ),
    ];
  }
  const cut = toSourceTime(clip, time);
  return [
    { ...clip, sourceOut: cut, fadeOut: 0, transition: undefined },
    { ...clip, id: createId(), start: time, sourceIn: cut, fadeIn: 0 },
  ];
}

function packTrack(track: Track): Track {
  let time = 0;
  let changed = false;
  const clips = track.clips.map((clip) => {
    const placed = clip.start === time ? clip : ((changed = true), { ...clip, start: time });
    time += clipDuration(clip);
    return placed;
  });
  return changed ? { ...track, clips } : track;
}

/**
 * Shortens fades and in/out animations that no longer fit their clip, e.g.
 * after a trim, and drops transitions whose clips no longer touch.
 */
function fitTimings(track: Track): Track {
  let changed = false;
  const clips = track.clips.map((clip) => {
    const length = clipDuration(clip);
    let next = clip;
    if (clip.transition) {
      const following = followingClip(track, clip);
      if (!following) next = { ...next, transition: undefined };
      else {
        const longest = Math.min(length, clipDuration(following));
        if (clip.transition.duration > longest) next = { ...next, transition: { ...clip.transition, duration: longest } };
      }
    }
    if (clip.fadeIn + clip.fadeOut > length) {
      const scale = length / (clip.fadeIn + clip.fadeOut);
      next = { ...next, fadeIn: Math.floor(clip.fadeIn * scale), fadeOut: Math.floor(clip.fadeOut * scale) };
    }
    const animation = clip.animation;
    const animated = (animation?.in?.duration ?? 0) + (animation?.out?.duration ?? 0);
    if (animation && animated > length) {
      const scale = length / animated;
      next = {
        ...next,
        animation: {
          ...animation,
          in: animation.in && { ...animation.in, duration: Math.floor(animation.in.duration * scale) },
          out: animation.out && { ...animation.out, duration: Math.floor(animation.out.duration * scale) },
        },
      };
    }
    if (next !== clip) changed = true;
    return next;
  });
  return changed ? { ...track, clips } : track;
}

function sortTrack(track: Track): Track {
  const sorted = track.clips.every((clip, i) => i === 0 || track.clips[i - 1]!.start <= clip.start);
  return sorted ? track : { ...track, clips: [...track.clips].sort(byStart) };
}

function byStart(a: Clip, b: Clip): number {
  return a.start - b.start;
}

/** Index at which a clip dropped at `time` lands on the main track: after every clip whose middle it passed. */
function mainInsertIndex(track: Track, time: Micros, ignoreId?: Id): number {
  return track.clips.filter((clip) => clip.id !== ignoreId && clip.start + clipDuration(clip) / 2 <= time).length;
}

function insertIntoMain(project: Project, clip: Clip, time: Micros): Project {
  return updateTrackAt(project, 0, (track) => {
    const clips = [...track.clips];
    clips.splice(mainInsertIndex(track, time), 0, clip);
    return { ...track, clips };
  });
}

function insertIntoMainAfter(project: Project, clip: Clip, afterId: Id): Project {
  return updateTrackAt(project, 0, (track) => {
    const clips = [...track.clips];
    clips.splice(clips.findIndex((c) => c.id === afterId) + 1, 0, clip);
    return { ...track, clips };
  });
}

function reorderMain(project: Project, clip: Clip, time: Micros): Project {
  return updateTrackAt(project, 0, (track) => {
    const index = mainInsertIndex(track, time, clip.id);
    const clips = track.clips.filter((c) => c.id !== clip.id);
    clips.splice(index, 0, clip);
    return { ...track, clips };
  });
}

/** Puts a clip on a track if it fits there, otherwise on a new track just above it. */
function placeOnTrack(project: Project, trackIndex: number, clip: Clip): Project {
  const track = project.tracks[trackIndex]!;
  if (fits(track, clip.start, clipEnd(clip), clip.id)) {
    return updateTrackAt(project, trackIndex, (t) => ({ ...t, clips: [...t.clips, clip] }));
  }
  return addTrackWith(project, track.kind, clip, trackIndex + 1);
}

function addTrackWith(project: Project, kind: TrackKind, clip: Clip, index: number): Project {
  const track = { ...createTrack(kind), clips: [clip] };
  const tracks = [...project.tracks];
  tracks.splice(Math.max(1, index), 0, track);
  return { ...project, tracks };
}

function fits(track: Track, start: Micros, end: Micros, ignoreId?: Id): boolean {
  return track.clips.every((clip) => clip.id === ignoreId || clipEnd(clip) <= start || clip.start >= end);
}

function previousEnd(track: Track, clip: Clip): Micros {
  let end = 0;
  for (const other of track.clips) {
    if (other.id !== clip.id && other.start < clip.start) end = Math.max(end, clipEnd(other));
  }
  return end;
}

function nextStart(track: Track, clip: Clip): Micros {
  let start = Infinity;
  for (const other of track.clips) {
    if (other.id !== clip.id && other.start > clip.start) start = Math.min(start, other.start);
  }
  return start;
}

function replaceClip(project: Project, trackIndex: number, clip: Clip): Project {
  return updateTrackAt(project, trackIndex, (track) => ({
    ...track,
    clips: track.clips.map((c) => (c.id === clip.id ? clip : c)),
  }));
}

function updateTrackAt(project: Project, index: number, update: (track: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((track, i) => (i === index ? update(track) : track)) };
}

function clampAdjustments(adjust: Adjustments): Adjustments {
  const out = { ...adjust };
  for (const key of Object.keys(out) as (keyof Adjustments)[]) {
    out[key] = clamp(out[key], key === "vignette" ? 0 : -1, 1);
  }
  return out;
}

function clampMask(mask: Mask): Mask {
  return {
    ...mask,
    width: clamp(mask.width, 0.01, 4),
    height: clamp(mask.height, 0.01, 4),
    feather: clamp(mask.feather, 0, 1),
  };
}

function clampKey(key: ChromaKey): ChromaKey {
  return { ...key, tolerance: clamp(key.tolerance, 0, 1), softness: clamp(key.softness, 0, 1), spill: clamp(key.spill, 0, 1) };
}

function clampEnhance(enhance: Enhance): Enhance {
  return {
    ...enhance,
    sharpen: clamp(enhance.sharpen, 0, 1),
    denoise: clamp(enhance.denoise, 0, 1),
    deband: clamp(enhance.deband, 0, 1),
    deblock: clamp(enhance.deblock, 0, 1),
  };
}

function clampCrop(crop: Crop): Crop {
  const left = clamp(crop.left, 0, 0.95);
  const top = clamp(crop.top, 0, 0.95);
  return {
    left,
    top,
    right: clamp(crop.right, 0, 0.95 - left),
    bottom: clamp(crop.bottom, 0, 0.95 - top),
  };
}

function normalizeAngle(degrees: number): number {
  const turned = ((degrees % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
