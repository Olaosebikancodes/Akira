import type { QualityLevel } from "mediabunny";
import { renderAudioMix } from "../audio/mix";
import { audioBufferToPcm, type PcmAudio, pcmTransferables } from "../audio/pcm";
import { audibleClips } from "../audio/schedule";
import { ExportCancelledError, type ExportOptions, exportProject } from "../export/export";
import { MediaFile, type MediaFiles } from "../media/media-file";
import type { Id, Project } from "../project/model";
import { projectDuration } from "../project/query";
import type { WorkerScope } from "./render-worker";

export type ExportRequest =
  | {
      type: "start";
      project: Project;
      files: { assetId: Id; file: File }[];
      audio: PcmAudio | null;
      quality?: QualityLevel;
    }
  | { type: "cancel" };

export type ExportEvent =
  | { type: "progress"; progress: number }
  | { type: "done"; blob: Blob }
  | { type: "error"; message: string; cancelled: boolean };

/** Runs exports in a worker, so a long render never freezes the editor. */
export function serveExportWorker(scope: WorkerScope): void {
  let controller: AbortController | null = null;
  const post = (event: ExportEvent) => scope.postMessage(event);

  scope.addEventListener("message", (event: MessageEvent<ExportRequest>) => {
    const message = event.data;
    if (message.type === "cancel") {
      controller?.abort();
      return;
    }
    controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      const files = new Map<Id, MediaFile>();
      try {
        for (const { assetId, file } of message.files) files.set(assetId, await MediaFile.open(file));
        const blob = await exportProject(message.project, files, {
          audio: message.audio,
          quality: message.quality,
          signal,
          onProgress: (progress) => post({ type: "progress", progress }),
        });
        post({ type: "done", blob });
      } catch (error) {
        post({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          cancelled: error instanceof ExportCancelledError,
        });
      } finally {
        for (const file of files.values()) file.dispose();
      }
    })();
  });
}

/**
 * Exports through a worker running `serveExportWorker`. The audio is mixed
 * here first, because OfflineAudioContext only exists on the main thread,
 * then handed over without copying.
 */
export async function exportInWorker(
  worker: Worker,
  project: Project,
  files: MediaFiles,
  options: Omit<ExportOptions, "audio"> = {},
): Promise<Blob> {
  const audio =
    audibleClips(project, files).length > 0
      ? audioBufferToPcm(await renderAudioMix(project, files, projectDuration(project)))
      : null;
  if (options.signal?.aborted) throw new ExportCancelledError();

  const used = usedAssets(project);
  const sources = [...files]
    .filter(([assetId]) => used.has(assetId))
    .map(([assetId, media]) => ({ assetId, file: media.file }));

  return new Promise((resolve, reject) => {
    const onAbort = () => worker.postMessage({ type: "cancel" } satisfies ExportRequest);
    options.signal?.addEventListener("abort", onAbort);
    const finish = () => {
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
    };
    const onMessage = (event: MessageEvent<ExportEvent>) => {
      const message = event.data;
      if (message.type === "progress") return options.onProgress?.(message.progress);
      finish();
      if (message.type === "done") resolve(message.blob);
      else reject(message.cancelled ? new ExportCancelledError() : new Error(message.message));
    };
    worker.addEventListener("message", onMessage);
    const request: ExportRequest = { type: "start", project, files: sources, audio, quality: options.quality };
    worker.postMessage(request, audio ? pcmTransferables(audio) : []);
  });
}

/** Assets the export actually reads: every clip's media and an image background. */
function usedAssets(project: Project): Set<Id> {
  const used = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)));
  if (project.canvas.background.kind === "image") used.add(project.canvas.background.assetId);
  return used;
}
