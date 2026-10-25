import { type AudibleClip, audibleClips, clipAudio, playPlacedBuffer } from "../audio/schedule";
import type { MediaFiles } from "../media/media-file";
import { projectDuration } from "../project/query";
import type { Project } from "../project/model";
import { Compositor } from "../render/compositor";
import { FrameRenderer } from "../render/frame-renderer";
import { type FrameRate, type Micros, microsToSeconds, secondsToMicros } from "../time";

/** How far ahead of the playhead audio is decoded and scheduled. */
const AUDIO_LOOKAHEAD: Micros = 1_000_000;

/** Gap before the first sound after pressing play, so decoders can get ahead. */
const START_DELAY_SECONDS = 0.1;

export interface PlayerEvents {
  onTimeUpdate?(time: Micros): void;
  onPlayingChange?(playing: boolean): void;
  onError?(error: unknown): void;
}

/**
 * Plays a project into a canvas with sound.
 *
 * The audio hardware is the clock: the playhead is derived from what the
 * speakers are outputting right now, and video frames follow it. When
 * decoding can't keep up, frames are dropped rather than letting the picture
 * drift away from the sound.
 */
export class Player {
  private readonly renderer: FrameRenderer;
  private readonly compositor: Compositor;
  private audioContext: AudioContext | null = null;

  private time: Micros = 0;
  private playing = false;
  /** Context time at which timeline time zero plays, while playing. */
  private timelineOrigin = 0;
  private animationFrame = 0;
  private audioSession: AudioSession | null = null;

  private drawing = false;
  private pendingDraw: Micros | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private project: Project,
    private files: MediaFiles,
    private readonly events: PlayerEvents = {},
  ) {
    this.compositor = new Compositor(canvas);
    this.compositor.resize(project.canvas.width, project.canvas.height);
    this.renderer = new FrameRenderer(this.compositor);
    this.requestDraw(0);
  }

  get currentTime(): Micros {
    return this.time;
  }

  get duration(): Micros {
    return projectDuration(this.project);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get frameRate(): FrameRate {
    return this.project.canvas.frameRate;
  }

  setProject(project: Project, files: MediaFiles): void {
    this.project = project;
    this.files = files;
    const { width, height } = project.canvas;
    if (this.compositor.width !== width || this.compositor.height !== height) {
      this.compositor.resize(width, height);
    }
    void this.renderer.prune(project);
    this.seek(Math.min(this.time, this.duration));
  }

  async play(): Promise<void> {
    if (this.playing || this.duration === 0) return;
    if (this.time >= this.duration) this.time = 0;

    const context = (this.audioContext ??= new AudioContext({ latencyHint: "interactive" }));
    // Browsers only let audio start from a user gesture, so resume before any other await.
    await context.resume();

    this.playing = true;
    this.startAudio(this.time);
    this.events.onPlayingChange?.(true);
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.time = Math.min(this.clock(), this.duration);
    this.stop();
    this.requestDraw(this.time);
    this.events.onTimeUpdate?.(this.time);
  }

  seek(time: Micros): void {
    this.time = Math.max(0, Math.min(time, this.duration));
    if (this.playing) this.startAudio(this.time);
    this.requestDraw(this.time);
    this.events.onTimeUpdate?.(this.time);
  }

  async dispose(): Promise<void> {
    if (this.playing) this.stop();
    await this.renderer.close();
    this.compositor.dispose();
    await this.audioContext?.close();
  }

  private stop(): void {
    this.playing = false;
    cancelAnimationFrame(this.animationFrame);
    this.audioSession?.stop();
    this.audioSession = null;
    this.events.onPlayingChange?.(false);
  }

  private readonly tick = (): void => {
    if (!this.playing) return;
    const time = this.clock();
    if (time >= this.duration) {
      this.pause();
      return;
    }
    this.time = time;
    this.requestDraw(time);
    this.events.onTimeUpdate?.(time);
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private startAudio(from: Micros): void {
    const context = this.audioContext!;
    this.audioSession?.stop();
    this.timelineOrigin = context.currentTime + START_DELAY_SECONDS - microsToSeconds(from);
    this.audioSession = new AudioSession(
      context,
      audibleClips(this.project, this.files),
      from,
      this.timelineOrigin,
      () => this.clock(),
      (error) => this.events.onError?.(error),
    );
  }

  /** The timeline time the listener is hearing right now. */
  private clock(): Micros {
    const heard = secondsToMicros(outputTime(this.audioContext!) - this.timelineOrigin);
    // Before the first sound plays, hold the picture on the starting frame.
    return Math.max(heard, this.audioSession?.from ?? 0);
  }

  /** Draws the latest requested time, skipping any requested in the meantime. */
  private requestDraw(time: Micros): void {
    // Clips end exclusively, so at the very end show the last frame, not black.
    this.pendingDraw = Math.min(time, Math.max(0, this.duration - 1));
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
        this.events.onError?.(error);
      } finally {
        this.drawing = false;
      }
    })();
  }
}

/**
 * The audio for one stretch of playback. Each clip streams its decoded
 * buffers into the context a little ahead of the playhead; seeking or pausing
 * stops the session and starts a fresh one.
 */
class AudioSession {
  private readonly nodes = new Set<AudioBufferSourceNode>();
  private readonly output: GainNode;
  private stopped = false;

  constructor(
    private readonly context: AudioContext,
    clips: AudibleClip[],
    readonly from: Micros,
    private readonly timelineOrigin: number,
    private readonly clock: () => Micros,
    onError: (error: unknown) => void,
  ) {
    this.output = context.createGain();
    this.output.connect(context.destination);
    for (const clip of clips) this.stream(clip).catch(onError);
  }

  stop(): void {
    this.stopped = true;
    for (const node of this.nodes) node.stop();
    this.nodes.clear();
    this.output.disconnect();
  }

  private async stream(clip: AudibleClip): Promise<void> {
    for await (const placed of clipAudio(clip, this.from)) {
      if (this.stopped) return;
      await this.waitUntilNeeded(placed.placement.at);
      if (this.stopped) return;

      const node = playPlacedBuffer(
        this.context,
        this.output,
        placed,
        clip.clip.speed,
        this.timelineOrigin,
      );
      if (!node) continue;
      this.nodes.add(node);
      node.onended = () => this.nodes.delete(node);
    }
  }

  /** Holds decoding back until the playhead is within the lookahead window. */
  private async waitUntilNeeded(at: Micros): Promise<void> {
    const wait = at - AUDIO_LOOKAHEAD - this.clock();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait / 1000));
  }
}

/**
 * Context time of the sound leaving the speakers now. `currentTime` runs
 * ahead of that by the output latency, which would put video early.
 */
function outputTime(context: AudioContext): number {
  if (typeof context.getOutputTimestamp !== "function") return context.currentTime;
  const { contextTime, performanceTime } = context.getOutputTimestamp();
  if (!contextTime || !performanceTime) return context.currentTime;
  return contextTime + (performance.now() - performanceTime) / 1000;
}
