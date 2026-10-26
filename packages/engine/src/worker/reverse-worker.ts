import { ReverseCancelledError, reverseMedia } from "../jobs/reverse";
import type { Micros } from "../time";
import type { WorkerScope } from "./render-worker";

export type ReverseRequest =
  | { type: "start"; file: File; start: Micros; end: Micros; name: string }
  | { type: "cancel" };

export type ReverseEvent =
  | { type: "progress"; progress: number }
  | { type: "done"; file: File }
  | { type: "error"; message: string; cancelled: boolean };

/** Reverses footage in a worker, so the editor stays responsive while it decodes and encodes. */
export function serveReverseWorker(scope: WorkerScope): void {
  let controller: AbortController | null = null;
  const post = (event: ReverseEvent) => scope.postMessage(event);

  scope.addEventListener("message", (event: MessageEvent<ReverseRequest>) => {
    const message = event.data;
    if (message.type === "cancel") {
      controller?.abort();
      return;
    }
    controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const blob = await reverseMedia(message.file, {
          start: message.start,
          end: message.end,
          signal,
          onProgress: (progress) => post({ type: "progress", progress }),
        });
        post({ type: "done", file: new File([blob!], message.name, { type: "video/mp4" }) });
      } catch (error) {
        post({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          cancelled: error instanceof ReverseCancelledError,
        });
      }
    })();
  });
}

export interface ReverseInWorkerOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

/** Reverses `start` to `end` of `file` in `worker`, resolving with the reversed copy. */
export function reverseInWorker(
  worker: Worker,
  file: File,
  range: { start: Micros; end: Micros },
  options: ReverseInWorkerOptions = {},
): Promise<File> {
  return new Promise((resolve, reject) => {
    const onAbort = () => worker.postMessage({ type: "cancel" } satisfies ReverseRequest);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", (event: MessageEvent<ReverseEvent>) => {
      const message = event.data;
      if (message.type === "progress") return options.onProgress?.(message.progress);
      options.signal?.removeEventListener("abort", onAbort);
      if (message.type === "done") resolve(message.file);
      else reject(message.cancelled ? new ReverseCancelledError(message.message) : new Error(message.message));
    });
    // A worker that fails to load or crashes says so here rather than in a message.
    worker.addEventListener("error", (event) => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new Error(event.message || "The reverse worker stopped unexpectedly."));
    });
    const name = `${file.name.replace(/\.[^.]+$/, "")} (reversed).mp4`;
    worker.postMessage({ type: "start", file, start: range.start, end: range.end, name } satisfies ReverseRequest);
  });
}
