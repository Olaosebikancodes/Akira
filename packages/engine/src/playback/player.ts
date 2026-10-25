import { connectClipChain } from "../audio/chain";
import { type AudibleClip, audibleClips, clipAudio, playPlacedBuffer } from "../audio/schedule";
import { loadAudioWorklets } from "../audio/worklet";
import type { MediaFiles } from "../media/media-file";
import type { Project } from "../project/model";
import { projectDuration } from "../project/query";
import { type FrameRate, type Micros, microsToSeconds, secondsToMicros } from "../time";
import { type ClockAnchor, LocalVideoOutput, type VideoOutput, WorkerVideoOutput, wallClock } from "./video-output";

/** How far ahead of the playhead audio is decoded and scheduled. */
const AUDIO_LOOKAHEAD: Micros = 1_000_000;

/** Gap before the first sound after pressing play, so decoders can get ahead. */
const START_DELAY_SECONDS = 0.1;

export interface PlayerEvents {
  onTimeUpdate?(time: Micros): void;
  onPlayingChange?(playing: boolean): void;
  onError?(error: unknown): void;
}

export interface PlayerOptions {
  /**
   * A worker running `serveRenderWorker`. When given, and the browser can
   * hand canvases to workers, video renders there instead of on the main thread.
   */
  renderWorker?: Worker;
  /** Absolute URL the built-in fonts are served from, ending in "/". Needed with a render worker. */
  fontBaseUrl?: string;
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
  private readonly video: VideoOutput;
  private audioContext: AudioContext | null = null;
  /** Everything the player sounds goes through here, so it can be muted, e.g. while recording. */
  private master: GainNode | null = null;
  private muted = false;

  private time: Micros = 0;
  private playing = false;
  /** Context time at which timeline time zero plays, while playing. */
  private timelineOrigin = 0;
  private animationFrame = 0;
  private audioSession: AudioSession | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private project: Project,
    private files: MediaFiles,
    private readonly events: PlayerEvents = {},
    options: PlayerOptions = {},
  ) {
    const onError = (error: unknown) => this.events.onError?.(error);
    this.video =
      options.renderWorker && "transferControlToOffscreen" in canvas
        ? new WorkerVideoOutput(options.renderWorker, canvas, project, files, options.fontBaseUrl ?? "/fonts/", onError)
        : new LocalVideoOutput(canvas, project, files, onError);
    this.video.show(0);
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
    this.video.setProject(project, files);
    this.seek(Math.min(this.time, this.duration));
  }

  /**
   * Creates and resumes the audio context. Browsers only allow this shortly
   * after a click, so call it at the start of a click handler that awaits
   * something else (such as a microphone prompt) before playing.
   */
  prepareAudio(): AudioContext {
    const context = (this.audioContext ??= new AudioContext({ latencyHint: "interactive" }));
    void context.resume();
    return context;
  }

  async play(): Promise<void> {
    if (this.playing || this.duration === 0) return;
    if (this.time >= this.duration) this.time = 0;

    // Browsers only let audio start from a user gesture, so resume before any other await.
    const context = this.prepareAudio();
    await context.resume();
    await loadAudioWorklets(context);
    if (!this.master) {
      this.master = context.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(context.destination);
    }

    this.playing = true;
    this.startAudio(this.time);
    this.video.playing(this.anchor(), true);
    this.events.onPlayingChange?.(true);
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.time = Math.min(this.clock(), this.duration);
    this.stop();
    this.video.show(this.time);
    this.events.onTimeUpdate?.(this.time);
  }

  seek(time: Micros): void {
    this.time = Math.max(0, Math.min(time, this.duration));
    if (this.playing) {
      this.startAudio(this.time);
      this.video.playing(this.anchor(), true);
    } else {
      this.video.show(this.time);
    }
    this.events.onTimeUpdate?.(this.time);
  }

  /**
   * The wall-clock time (as `performance.timeOrigin + performance.now()`) at
   * which timeline time `time` is or was heard, during playback. Lets a
   * recording started alongside playback be placed exactly. Null when paused.
   */
  heardAt(time: Micros): number | null {
    if (!this.playing || !this.audioContext) return null;
    const contextTime = this.timelineOrigin + microsToSeconds(time);
    return wallClock() + (contextTime - outputTime(this.audioContext)) * 1000;
  }

  /** Silences playback without stopping it, e.g. so a voiceover doesn't record the project. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  async dispose(): Promise<void> {
    if (this.playing) this.stop();
    await this.video.dispose();
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
    this.video.playing(this.anchor(time), false);
    this.events.onTimeUpdate?.(time);
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private startAudio(from: Micros): void {
    const context = this.audioContext!;
    this.audioSession?.stop();
    this.timelineOrigin = context.currentTime + START_DELAY_SECONDS - microsToSeconds(from);
    this.audioSession = new AudioSession(
      context,
      this.master!,
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

  /** Pins the heard time to the wall clock so a worker can extrapolate it between syncs. */
  private anchor(time: Micros = this.clock()): ClockAnchor {
    return { time, at: wallClock(), from: this.audioSession?.from ?? time };
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
    destination: AudioNode,
    clips: AudibleClip[],
    readonly from: Micros,
    private readonly timelineOrigin: number,
    private readonly clock: () => Micros,
    onError: (error: unknown) => void,
  ) {
    this.output = context.createGain();
    this.output.connect(destination);
    for (const clip of clips) this.stream(clip).catch(onError);
  }

  stop(): void {
    this.stopped = true;
    for (const node of this.nodes) node.stop();
    this.nodes.clear();
    this.output.disconnect();
  }

  private async stream(clip: AudibleClip): Promise<void> {
    const chain = connectClipChain(this.context, this.output, clip.clip, this.timelineOrigin, this.from);
    for await (const placed of clipAudio(clip, this.from)) {
      if (this.stopped) return;
      await this.waitUntilNeeded(placed.placement.at);
      if (this.stopped) return;

      // Filters that delay their output (hiss reduction) get their audio that much early.
      const node = playPlacedBuffer(
        this.context,
        chain.input,
        placed,
        clip.clip.speed,
        this.timelineOrigin - chain.latency,
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
