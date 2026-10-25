import { MediaFile } from "../media/media-file";
import type { Id, Project } from "../project/model";
import { projectDuration } from "../project/query";
import { Compositor } from "../render/compositor";
import { setFontBaseUrl } from "../render/fonts";
import { FrameRenderer } from "../render/frame-renderer";
import type { Micros } from "../time";

/** Messages the main thread sends the render worker. */
export type RenderRequest =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      /** Absolute URL the built-in fonts are served from, ending in "/". */
      fontBaseUrl: string;
    }
  | { type: "files"; add: { assetId: Id; file: File }[]; remove: Id[] }
  | { type: "project"; project: Project }
  | {
      type: "clock";
      playing: boolean;
      /** Timeline time being heard at wall-clock time `at`. */
      time: Micros;
      /** Milliseconds since the epoch: `performance.timeOrigin + performance.now()`. */
      at: number;
      /** While playing, never show earlier than this: where playback started. */
      from: Micros;
    };

export type RenderEvent = { type: "error"; message: string };

/** The parts of a dedicated worker's global scope this needs. */
export interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
}

/**
 * Runs the preview's video in a worker: it opens its own copies of the
 * media, renders on a canvas handed over from the page, and while playing
 * keeps its own frame loop running from a clock anchor the page sends. Video
 * keeps up even when the page's main thread is busy with the UI.
 */
export function serveRenderWorker(scope: WorkerScope): void {
  const files = new Map<Id, MediaFile>();
  let compositor: Compositor | null = null;
  let renderer: FrameRenderer | null = null;
  let project: Project | null = null;
  let clock = { playing: false, time: 0, at: 0, from: 0 };
  let animationFrame = 0;
  let drawing = false;
  let pendingDraw: Micros | null = null;

  const report = (error: unknown) =>
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) } satisfies RenderEvent);

  const now = () => performance.timeOrigin + performance.now();

  function clockTime(): Micros {
    if (!clock.playing) return clock.time;
    return Math.max(clock.from, clock.time + Math.round((now() - clock.at) * 1000));
  }

  function requestDraw(time: Micros) {
    if (!project) return;
    // Clips end exclusively, so at the very end show the last frame, not black.
    pendingDraw = Math.min(time, Math.max(0, projectDuration(project) - 1));
    if (drawing) return;
    drawing = true;
    void (async () => {
      try {
        while (pendingDraw !== null && renderer && project) {
          const next = pendingDraw;
          pendingDraw = null;
          await renderer.render(project, files, next);
        }
      } catch (error) {
        report(error);
      } finally {
        drawing = false;
      }
    })();
  }

  function tick() {
    if (!clock.playing) return;
    requestDraw(clockTime());
    animationFrame = requestAnimationFrame(tick);
  }

  async function updateFiles(add: { assetId: Id; file: File }[], remove: Id[]) {
    for (const id of remove) {
      files.get(id)?.dispose();
      files.delete(id);
    }
    for (const { assetId, file } of add) {
      try {
        files.set(assetId, await MediaFile.open(file));
      } catch (error) {
        report(error);
      }
    }
    requestDraw(clockTime());
  }

  scope.addEventListener("message", (event: MessageEvent<RenderRequest>) => {
    const message = event.data;
    switch (message.type) {
      case "init":
        setFontBaseUrl(message.fontBaseUrl);
        compositor = new Compositor(message.canvas);
        renderer = new FrameRenderer(compositor);
        break;
      case "files":
        void updateFiles(message.add, message.remove);
        break;
      case "project": {
        project = message.project;
        const { width, height } = project.canvas;
        if (compositor && (compositor.width !== width || compositor.height !== height)) compositor.resize(width, height);
        void renderer?.prune(project);
        if (!clock.playing) requestDraw(clock.time);
        break;
      }
      case "clock":
        clock = message;
        cancelAnimationFrame(animationFrame);
        if (clock.playing) animationFrame = requestAnimationFrame(tick);
        else requestDraw(clock.time);
        break;
    }
  });
}
