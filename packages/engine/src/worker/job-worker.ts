import { measureCameraMotion, type TrackOptions, type TrackPoint, trackRegion } from "../jobs/analyze";
import { JobCancelledError } from "../jobs/cancel";
import { reverseMedia } from "../jobs/reverse";
import type { CameraMotion } from "../project/model";
import type { Micros } from "../time";
import type { WorkerScope } from "./render-worker";

/** Work that runs in the background on part of a media file. */
export type Job =
  | { kind: "reverse"; file: File; start: Micros; end: Micros; name: string }
  | { kind: "stabilize"; file: File; start: Micros; end: Micros }
  | { kind: "track"; file: File; start: Micros; end: Micros; region: TrackOptions["region"] };

export type JobResult =
  | { kind: "reverse"; file: File }
  | { kind: "stabilize"; motion: CameraMotion }
  | { kind: "track"; points: TrackPoint[] };

type JobRequest = { type: "start"; job: Job } | { type: "cancel" };

type JobEvent =
  | { type: "progress"; progress: number }
  | { type: "done"; result: JobResult }
  | { type: "error"; message: string; cancelled: boolean };

/**
 * Runs background jobs in a worker: decoding and measuring footage is heavy,
 * and here it never holds up editing or playback.
 */
export function serveJobWorker(scope: WorkerScope): void {
  let controller: AbortController | null = null;
  const post = (event: JobEvent) => scope.postMessage(event);

  scope.addEventListener("message", (event: MessageEvent<JobRequest>) => {
    const message = event.data;
    if (message.type === "cancel") {
      controller?.abort();
      return;
    }
    controller = new AbortController();
    const options = { signal: controller.signal, onProgress: (progress: number) => post({ type: "progress", progress }) };
    void (async () => {
      try {
        post({ type: "done", result: await run(message.job, options) });
      } catch (error) {
        post({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          cancelled: error instanceof JobCancelledError,
        });
      }
    })();
  });
}

async function run(job: Job, options: { signal: AbortSignal; onProgress: (progress: number) => void }): Promise<JobResult> {
  const range = { start: job.start, end: job.end, ...options };
  switch (job.kind) {
    case "reverse": {
      const blob = await reverseMedia(job.file, range);
      return { kind: "reverse", file: new File([blob!], job.name, { type: "video/mp4" }) };
    }
    case "stabilize":
      return { kind: "stabilize", motion: await measureCameraMotion(job.file, range) };
    case "track":
      return { kind: "track", points: await trackRegion(job.file, { ...range, region: job.region }) };
  }
}

export interface RunJobOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

/** Runs `job` in `worker`, resolving with its result. Use one worker per job. */
export function runJobInWorker<K extends Job["kind"]>(
  worker: Worker,
  job: Extract<Job, { kind: K }>,
  options: RunJobOptions = {},
): Promise<Extract<JobResult, { kind: K }>> {
  return new Promise((resolve, reject) => {
    const onAbort = () => worker.postMessage({ type: "cancel" } satisfies JobRequest);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", (event: MessageEvent<JobEvent>) => {
      const message = event.data;
      if (message.type === "progress") return options.onProgress?.(message.progress);
      options.signal?.removeEventListener("abort", onAbort);
      if (message.type === "done") resolve(message.result as Extract<JobResult, { kind: K }>);
      else reject(message.cancelled ? new JobCancelledError(message.message) : new Error(message.message));
    });
    // A worker that fails to load or crashes says so here rather than in a message.
    worker.addEventListener("error", (event) => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new Error(event.message || "A background job stopped unexpectedly."));
    });
    worker.postMessage({ type: "start", job } satisfies JobRequest);
  });
}
