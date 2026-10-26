"use client";

import {
  type Asset,
  createId,
  type Id,
  isReversed,
  isStill,
  locateClip,
  MediaFile,
  ReverseCancelledError,
  reverseClip,
  reversedCopyFor,
  reverseInWorker,
  unreverseClip,
} from "@akira/engine";
import { targetClipIds } from "./actions";
import { addGeneratedAsset, commit, finishJob, notify, startJob, updateJob, useEditor } from "./store";

const get = useEditor.getState;

/** Whether the clip could be reversed: moving footage or sound, not a still or text. */
export function canReverse(clipId: Id | undefined): boolean {
  if (!clipId) return false;
  const { project, jobs } = get();
  const found = locateClip(project, clipId);
  return !!found && !found.track.locked && !isStill(project, found.clip) && !jobs.some((job) => job.clipId === clipId);
}

/**
 * Plays the target clip backwards, or forwards again if it already is.
 * Reversing needs a reversed copy of the footage; one made earlier is
 * reused, otherwise it's made in the background while editing carries on.
 */
export async function toggleReverse(): Promise<void> {
  const clipId = targetClipIds()[0];
  if (!clipId || !canReverse(clipId)) return;
  const { project, files } = get();
  const { clip } = locateClip(project, clipId)!;
  if (isReversed(project, clip)) return commit((p) => unreverseClip(p, clipId));

  const cached = reversedCopyFor(project, clip);
  if (cached) return commit((p) => reverseClip(p, clipId, cached.id));

  const media = files.get(clip.assetId);
  if (!media) return notify({ kind: "error", message: "This clip's media isn't open, so it can't be reversed." });
  const range = { start: clip.sourceIn, end: clip.sourceOut };
  const original = project.assets[clip.assetId]!;
  const controller = new AbortController();
  const jobId = startJob({ clipId, label: `Reversing ${original.name}`, cancel: () => controller.abort() });
  const worker = new Worker(new URL("./workers/reverse.worker.ts", import.meta.url), { type: "module" });
  try {
    const file = await reverseInWorker(worker, media.file, range, {
      signal: controller.signal,
      onProgress: (progress) => updateJob(jobId, progress),
    });
    const opened = await MediaFile.open(file);
    // Named after the original: it's still the user's clip, played the other way.
    const asset: Asset = { id: createId(), ...opened.info, name: original.name, reverseOf: { assetId: clip.assetId, ...range } };
    addGeneratedAsset(asset, opened);
    // The clip may have been trimmed while this ran; reverseClip checks the copy still covers it.
    commit((p) => reverseClip(p, clipId, asset.id));
  } catch (error) {
    if (!(error instanceof ReverseCancelledError)) {
      notify({ kind: "error", message: `Couldn't reverse ${original.name}. ${error instanceof Error ? error.message : String(error)}` });
    }
  } finally {
    worker.terminate();
    finishJob(jobId);
  }
}
