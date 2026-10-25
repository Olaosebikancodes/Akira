import type { MediaFiles } from "../media/media-file";
import type { Id, Project } from "../project/model";
import { projectDuration } from "../project/query";
import { Compositor } from "../render/compositor";
import { FrameRenderer } from "../render/frame-renderer";
import type { Micros } from "../time";
import type { RenderEvent, RenderRequest } from "../worker/render-worker";

/** How often a playing worker is re-synced to the audio clock. */
const SYNC_INTERVAL_MS = 250;

/** "Timeline time `time` was being heard at wall-clock time `at`." */
export interface ClockAnchor {
  time: Micros;
  /** Milliseconds since the epoch: `performance.timeOrigin + performance.now()`. */
  at: number;
  /** Where playback started; the picture never shows earlier than this while playing. */
  from: Micros;
}

/** Where the player's pictures go: drawn on the main thread, or in a worker. */
export interface VideoOutput {
  setProject(project: Project, files: MediaFiles): void;
  /** Paused: show this time. */
  show(time: Micros): void;
  /** Playing: called every animation frame. `restart` marks a jump such as a seek. */
  playing(anchor: ClockAnchor, restart: boolean): void;
  dispose(): Promise<void>;
}

export function wallClock(): number {
  return performance.timeOrigin + performance.now();
}

/** Renders on the main thread. The fallback where a canvas can't move to a worker. */
export class LocalVideoOutput implements VideoOutput {
  private readonly compositor: Compositor;
  private readonly renderer: FrameRenderer;
  private drawing = false;
  private pendingDraw: Micros | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private project: Project,
    private files: MediaFiles,
    private readonly onError: (error: unknown) => void,
  ) {
    this.compositor = new Compositor(canvas);
    this.renderer = new FrameRenderer(this.compositor);
    this.setProject(project, files);
  }

  setProject(project: Project, files: MediaFiles): void {
    this.project = project;
    this.files = files;
    const { width, height } = project.canvas;
    if (this.compositor.width !== width || this.compositor.height !== height) this.compositor.resize(width, height);
    void this.renderer.prune(project);
  }

  show(time: Micros): void {
    this.requestDraw(time);
  }

  playing(anchor: ClockAnchor): void {
    this.requestDraw(anchor.time);
  }

  async dispose(): Promise<void> {
    await this.renderer.close();
    this.compositor.dispose();
  }

  /** Draws the latest requested time, skipping any requested in the meantime. */
  private requestDraw(time: Micros): void {
    // Clips end exclusively, so at the very end show the last frame, not black.
    this.pendingDraw = Math.min(time, Math.max(0, projectDuration(this.project) - 1));
    if (this.drawing) return;
    this.drawing = true;
    void (async () => {
      try {
        while (this.pendingDraw !== null) {
          const next = this.pendingDraw;
          this.pendingDraw = null;
          await this.renderer.render(this.project, this.files, next);
        }
      } catch (error) {
        this.onError(error);
      } finally {
        this.drawing = false;
      }
    })();
  }
}

/**
 * Hands the canvas to a render worker (see `serveRenderWorker`). While
 * playing, the worker keeps its own frame loop and only needs a fresh clock
 * anchor a few times a second, so the picture keeps moving even when the
 * main thread is busy.
 */
export class WorkerVideoOutput implements VideoOutput {
  private readonly sent = new Set<Id>();
  private lastSync = 0;
  private wasPlaying = false;

  constructor(
    private readonly worker: Worker,
    canvas: HTMLCanvasElement,
    project: Project,
    files: MediaFiles,
    fontBaseUrl: string,
    onError: (error: unknown) => void,
  ) {
    const offscreen = canvas.transferControlToOffscreen();
    this.post({ type: "init", canvas: offscreen, fontBaseUrl }, [offscreen]);
    worker.addEventListener("message", (event: MessageEvent<RenderEvent>) => {
      if (event.data.type === "error") onError(new Error(event.data.message));
    });
    this.setProject(project, files);
  }

  setProject(project: Project, files: MediaFiles): void {
    // The worker opens its own copy of each file it draws with: pictures and fonts.
    const add: { assetId: Id; file: File }[] = [];
    for (const [assetId, media] of files) {
      const draws = media.video || media.image || media.info.kind === "font";
      if (this.sent.has(assetId) || !draws) continue;
      add.push({ assetId, file: media.file });
      this.sent.add(assetId);
    }
    const remove = [...this.sent].filter((assetId) => !files.has(assetId));
    for (const assetId of remove) this.sent.delete(assetId);
    if (add.length > 0 || remove.length > 0) this.post({ type: "files", add, remove });
    this.post({ type: "project", project });
  }

  show(time: Micros): void {
    this.wasPlaying = false;
    this.post({ type: "clock", playing: false, time, at: wallClock(), from: time });
  }

  playing(anchor: ClockAnchor, restart: boolean): void {
    const now = wallClock();
    if (!restart && this.wasPlaying && now - this.lastSync < SYNC_INTERVAL_MS) return;
    this.wasPlaying = true;
    this.lastSync = now;
    this.post({ type: "clock", playing: true, ...anchor });
  }

  async dispose(): Promise<void> {
    this.worker.terminate();
  }

  private post(message: RenderRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }
}
