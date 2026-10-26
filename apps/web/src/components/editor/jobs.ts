"use client";

import {
  applyTracking,
  type Asset,
  canvasToPicture,
  clipEnd,
  createId,
  type Id,
  isReversed,
  isStill,
  type Job,
  JobCancelledError,
  type JobResult,
  locateClip,
  MediaFile,
  motionCovers,
  pointInQuad,
  reverseClip,
  reversedCopyFor,
  runJobInWorker,
  setStabilize,
  sourceTimeAt,
  toSourceTime,
  unreverseClip,
} from "@akira/engine";
import { targetClipIds } from "./actions";
import { visibleLayers } from "./layers";
import { addGeneratedAsset, commit, finishJob, notify, setTrackingSetup, startJob, updateAsset, updateJob, useEditor } from "./store";

const get = useEditor.getState;

/** Stabilising starts here: noticeably steadier without zooming in much. */
export const DEFAULT_STABILIZE = 0.5;

/**
 * Runs a job in its own worker, listed in the corner with its progress and
 * a Cancel button. Resolves with the result, or null if it was cancelled or
 * failed (failures are reported).
 */
async function runJob<K extends Job["kind"]>(clipId: Id, label: string, job: Extract<Job, { kind: K }>): Promise<Extract<JobResult, { kind: K }> | null> {
  const controller = new AbortController();
  const jobId = startJob({ clipId, label, cancel: () => controller.abort() });
  const worker = new Worker(new URL("./workers/job.worker.ts", import.meta.url), { type: "module" });
  try {
    return await runJobInWorker(worker, job, { signal: controller.signal, onProgress: (progress) => updateJob(jobId, progress) });
  } catch (error) {
    if (!(error instanceof JobCancelledError)) {
      notify({ kind: "error", message: `${label} didn't finish. ${error instanceof Error ? error.message : String(error)}` });
    }
    return null;
  } finally {
    worker.terminate();
    finishJob(jobId);
  }
}

/** Whether background work could start on the clip: moving footage, not busy already. */
export function canRunJob(clipId: Id | undefined): boolean {
  if (!clipId) return false;
  const { project, jobs } = get();
  const found = locateClip(project, clipId);
  return !!found && !found.track.locked && !isStill(project, found.clip) && !jobs.some((job) => job.clipId === clipId);
}

/** Whether the clip could be reversed: moving footage or sound, not a still or text. */
export const canReverse = canRunJob;

/**
 * Plays the target clip backwards, or forwards again if it already is.
 * Reversing needs a reversed copy of the footage; one made earlier is
 * reused, otherwise it's made in the background while editing carries on.
 */
export async function toggleReverse(): Promise<void> {
  const clipId = targetClipIds()[0];
  if (!clipId || !canRunJob(clipId)) return;
  const { project, files } = get();
  const { clip } = locateClip(project, clipId)!;
  if (isReversed(project, clip)) return commit((p) => unreverseClip(p, clipId));

  const cached = reversedCopyFor(project, clip);
  if (cached) return commit((p) => reverseClip(p, clipId, cached.id));

  const media = files.get(clip.assetId);
  if (!media) return notify({ kind: "error", message: "This clip's media isn't open, so it can't be reversed." });
  const original = project.assets[clip.assetId]!;
  const range = { start: clip.sourceIn, end: clip.sourceOut };
  const name = `${media.file.name.replace(/\.[^.]+$/, "")} (reversed).mp4`;
  const result = await runJob(clipId, `Reversing ${original.name}`, { kind: "reverse", file: media.file, ...range, name });
  if (!result) return;
  try {
    const opened = await MediaFile.open(result.file);
    // Named after the original: it's still the user's clip, played the other way.
    const asset: Asset = { id: createId(), ...opened.info, name: original.name, reverseOf: { assetId: clip.assetId, ...range } };
    addGeneratedAsset(asset, opened);
    // The clip may have been trimmed while this ran; reverseClip checks the copy still covers it.
    commit((p) => reverseClip(p, clipId, asset.id));
  } catch (error) {
    notify({ kind: "error", message: `Couldn't open the reversed copy. ${error instanceof Error ? error.message : String(error)}` });
  }
}

/**
 * Steadies a clip. The camera's movement is measured once per stretch of
 * footage, in the background, and kept with the media, so steadying
 * another clip from the same footage, or changing the strength, is instant.
 */
export async function stabilizeClip(clipId: Id): Promise<void> {
  const { project, files } = get();
  const found = locateClip(project, clipId);
  if (!found || !canRunJob(clipId)) return;
  const { clip } = found;
  if (motionCovers(project, clip)) return commit((p) => setStabilize(p, clipId, DEFAULT_STABILIZE));

  const media = files.get(clip.assetId);
  if (!media?.video) return notify({ kind: "error", message: "Only video clips can be stabilised." });
  const asset = project.assets[clip.assetId]!;
  const result = await runJob(clipId, `Measuring shake in ${asset.name}`, {
    kind: "stabilize",
    file: media.file,
    start: clip.sourceIn,
    end: clip.sourceOut,
  });
  if (!result) return;
  updateAsset(asset.id, { motion: result.motion });
  commit((p) => setStabilize(p, clipId, DEFAULT_STABILIZE));
}

/** Starts drawing a box on the canvas around what `followerId` should follow. */
export function beginTracking(followerId: Id, followScale: boolean): void {
  setTrackingSetup({ followerId, followScale });
}

/**
 * Tracks what's inside `box` (canvas pixels) in the video beneath the
 * follower, from the playhead to the end of the follower, then turns the
 * path into keyframes so the follower moves with it.
 */
export async function trackBox(box: { x: number; y: number; width: number; height: number }): Promise<void> {
  const setup = get().trackingSetup;
  setTrackingSetup(null);
  if (!setup) return;
  const { project, files, time } = get();
  const follower = locateClip(project, setup.followerId)?.clip;
  if (!follower) return;

  // The topmost other video under the middle of the box is what gets tracked.
  const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  const target = visibleLayers(project, time)
    .reverse()
    .find(({ clip, geometry }) => clip.id !== follower.id && files.get(clip.assetId)?.video && pointInQuad(centre, geometry.corners));
  if (!target) return notify({ kind: "error", message: "Draw the box over a video beneath this clip, around what it should follow." });

  // The box as fractions of the target's own picture.
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => canvasToPicture(target.geometry.model, target.clip.crop, x!, y!));
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const region = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };

  const start = sourceTimeAt(target.clip, time);
  const end = Math.min(target.clip.sourceOut, toSourceTime(target.clip, Math.min(clipEnd(follower), clipEnd(target.clip))));
  if (end - start < 50_000) return notify({ kind: "error", message: "There's too little of the clip left after the playhead to track." });
  const asset = project.assets[target.clip.assetId]!;
  const result = await runJob(follower.id, `Tracking in ${asset.name}`, {
    kind: "track",
    file: files.get(target.clip.assetId)!.file,
    start,
    end,
    region,
  });
  if (!result) return;
  if (result.points.some((point) => !point.found)) {
    notify({ kind: "warning", message: "The tracked object was lost part of the way, so the clip holds still from there. Adjust its keyframes if needed." });
  }
  commit((p) => applyTracking(p, follower.id, target.clip.id, result.points, { followScale: setup.followScale }));
}
