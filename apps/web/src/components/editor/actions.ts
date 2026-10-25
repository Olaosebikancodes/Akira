"use client";

import {
  addMarker,
  type Asset,
  clipAt,
  clipEnd,
  createClip,
  deleteClips,
  detachAudio,
  duplicateClips,
  frameToMicros,
  freezeFrame,
  type Id,
  insertClip,
  locateClip,
  mainTrack,
  microsToFrame,
  nudgeClip,
  originalSize,
  projectDuration,
  removeMarker,
  replaceClipAsset,
  splitClip,
  trimClip,
} from "@akira/engine";
import { startRecording } from "./recorder";
import { commit, importFiles, notify, seek, select, setZoom, useEditor } from "./store";

const get = useEditor.getState;

/** The clips an action applies to: the selection, or the main-track clip under the playhead. */
export function targetClipIds(): Id[] {
  const { selection, project, time } = get();
  if (selection.length > 0) return selection;
  const clip = clipAt(mainTrack(project), time);
  return clip ? [clip.id] : [];
}

export function splitAtPlayhead(): void {
  const { time } = get();
  const created: Id[] = [];
  commit((project) => {
    let next = project;
    for (const id of targetClipIds()) {
      const result = splitClip(next, id, time);
      next = result.project;
      if (result.rightId) created.push(result.rightId);
    }
    return next;
  });
  if (created.length > 0 && get().selection.length > 0) select(created);
}

export function deleteSelection(ripple: boolean): void {
  const ids = get().selection;
  if (ids.length === 0) return;
  commit((project) => deleteClips(project, ids, ripple));
  select([]);
}

export function duplicateSelection(): void {
  const ids = targetClipIds();
  let newIds: Id[] = [];
  commit((project) => {
    const result = duplicateClips(project, ids);
    newIds = result.newIds;
    return result.project;
  });
  if (newIds.length > 0) select(newIds);
}

export function freezeAtPlayhead(): void {
  const { time } = get();
  const id = targetClipIds()[0];
  if (!id) return;
  let freezeId: Id | null = null;
  commit((project) => {
    const result = freezeFrame(project, id, time);
    freezeId = result.freezeId;
    return result.project;
  });
  if (freezeId) select([freezeId]);
}

export function detachSelectedAudio(): void {
  const created: Id[] = [];
  commit((project) => {
    let next = project;
    for (const id of targetClipIds()) {
      const result = detachAudio(next, id);
      next = result.project;
      if (result.audioClipId) created.push(result.audioClipId);
    }
    return next;
  });
  if (created.length > 0) select(created);
}

export async function replaceSelected(file: File): Promise<void> {
  const id = targetClipIds()[0];
  if (!id) return;
  const [asset] = await importFiles([file]);
  if (asset) commit((project) => replaceClipAsset(project, id, asset));
}

/** Trims the target clips' start or end to the playhead, like dragging the edge there. */
export function trimToPlayhead(edge: "start" | "end"): void {
  const { time } = get();
  const ids = targetClipIds();
  commit((project) => ids.reduce((next, id) => trimClip(next, id, edge, time), project));
  if (edge === "start" && ids[0]) {
    // On the main track the clip slides back to close the gap; keep the playhead on its new start.
    const found = locateClip(get().project, ids[0]);
    if (found) seek(found.clip.start);
  }
}

export function nudgeSelection(frames: number): void {
  const ids = get().selection;
  commit((project) => ids.reduce((next, id) => nudgeClip(next, id, frames), project));
}

export function toggleMarkerAtPlayhead(): void {
  const { time } = get();
  commit((project) => {
    const existing = project.markers.find((marker) => marker.time === time);
    return existing ? removeMarker(project, existing.id) : addMarker(project, time);
  });
}

/**
 * Adds media to the timeline. Pictures go onto the main track at the gap
 * nearest the playhead; audio goes onto an audio track at the playhead. The
 * first clip in an empty project sets its size and frame rate.
 */
export function addToTimeline(asset: Asset, placement?: { trackId?: Id; time: number }): void {
  const clip = createClip(asset, 0);
  const isEmpty = get().project.tracks.every((track) => track.clips.length === 0);
  commit((project) => {
    const target = placement ?? (asset.kind === "audio" ? { time: get().time } : { trackId: mainTrack(project).id, time: get().time });
    let next = insertClip(project, clip, target);
    if (isEmpty) {
      const size = originalSize(next);
      const frameRate = asset.video?.frameRate ?? next.canvas.frameRate;
      if (size) next = { ...next, canvas: { ...next.canvas, ...size, frameRate } };
    }
    return next;
  });
  select([clip.id]);
}

/**
 * Records the microphone while the timeline plays from the playhead, with
 * the project muted so it isn't picked up.
 */
export async function startVoiceover(): Promise<void> {
  const { player, time, recording, project } = get();
  if (recording) return;
  // Unlock audio now: the microphone prompt can outlast the browser's click allowance.
  player?.prepareAudio();
  const takes = Object.values(project.assets).filter((asset) => asset.name.startsWith("Voiceover")).length;
  let take;
  try {
    take = await startRecording(`Voiceover ${takes + 1}`);
  } catch (error) {
    notify({ kind: "error", message: microphoneProblem(error) });
    return;
  }
  player?.setMuted(true);
  await player?.play();
  useEditor.setState({ recording: { from: time, heardAt: player?.heardAt(time) ?? null, take } });
}

/** Stops recording and puts the take on an audio track, lined up with what was playing. */
export async function stopVoiceover(): Promise<void> {
  const { recording, player } = get();
  if (!recording) return;
  useEditor.setState({ recording: null });
  player?.pause();
  player?.setMuted(false);

  const file = await recording.take.stop();
  const [asset] = await importFiles([file]);
  if (!asset) return;
  // The mic and the speakers start at slightly different moments; shift the take by the difference.
  const offset = recording.heardAt === null ? 0 : Math.round((recording.take.startedAt - recording.heardAt) * 1000);
  const start = recording.from + offset;
  let clip = createClip(asset, 0);
  if (start < 0) clip = { ...clip, sourceIn: clip.sourceIn - start };
  commit((project) => insertClip(project, clip, { time: Math.max(0, start) }));
  select([clip.id]);
}

function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return "Akira needs permission to use your microphone. Allow it in your browser's site settings, then try again.";
  }
  if (name === "NotFoundError") return "No microphone was found. Connect one, then try again.";
  return `The microphone couldn't start: ${error instanceof Error ? error.message : String(error)}`;
}

export function stepFrames(frames: number): void {
  const { project, time, player } = get();
  if (player?.isPlaying) player.pause();
  const rate = project.canvas.frameRate;
  seek(frameToMicros(Math.max(0, microsToFrame(get().player?.currentTime ?? time, rate) + frames), rate));
}

export function seekToEnd(): void {
  seek(projectDuration(get().project));
}

/** Jumps to the previous or next clip edge or marker. */
export function seekToEdit(direction: -1 | 1): void {
  const { project, time } = get();
  const edits = new Set<number>([0, ...project.markers.map((m) => m.time)]);
  for (const track of project.tracks) for (const clip of track.clips) edits.add(clip.start).add(clipEnd(clip));
  const sorted = [...edits].sort((a, b) => a - b);
  const target = direction > 0 ? sorted.find((t) => t > time) : sorted.reverse().find((t) => t < time);
  if (target !== undefined) seek(target);
}

/** Zooms so the whole project fits in `width` pixels. */
export function zoomToFit(width: number): void {
  const seconds = Math.max(1, projectDuration(get().project) / 1_000_000);
  setZoom((width * 0.92) / seconds);
}
