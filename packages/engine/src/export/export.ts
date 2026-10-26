import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
  type QualityLevel,
  WebMOutputFormat,
} from "mediabunny";
import { MIX_CHANNELS, MIX_SAMPLE_RATE, renderAudioMix } from "../audio/mix";
import { type PcmAudio, planar } from "../audio/pcm";
import { audibleClips } from "../audio/schedule";
import type { MediaFiles } from "../media/media-file";
import { projectDuration } from "../project/query";
import type { Project } from "../project/model";
import { Compositor, type FinishOptions } from "../render/compositor";
import { FrameRenderer } from "../render/frame-renderer";
import { frameRateToNumber, frameToMicros, microsToFrame, microsToSeconds } from "../time";

/** MP4 (H.264 and AAC), which everything plays, or WebM (VP9 and Opus). */
export type ExportFormat = "mp4" | "webm";

const CODECS = {
  mp4: { video: ["avc"], audio: ["aac", "opus"], type: "video/mp4", label: "H.264" },
  webm: { video: ["vp9", "vp8"], audio: ["opus"], type: "video/webm", label: "VP9" },
} as const;

export interface ExportOptions {
  /** Encoder quality. Defaults to "very-high", for a final render. */
  quality?: QualityLevel;
  /** MP4 unless given. */
  format?: ExportFormat;
  /** Output size; the project's when left out. Keep the project's shape, or the picture is squeezed. */
  width?: number;
  height?: number;
  /** A fixed video bitrate in bits per second, used instead of `quality`, e.g. to fit a size limit. */
  videoBitrate?: number;
  /** Clean-up run on every finished frame, for platforms that re-compress what's uploaded. */
  finish?: FinishOptions;
  /** Called after each video frame with progress from 0 to 1. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  /**
   * The project's audio, already mixed, or null for none. Workers have to
   * pass this in because OfflineAudioContext only exists on the main thread;
   * when it's left out the mix is rendered here.
   */
  audio?: PcmAudio | null;
}

export class ExportCancelledError extends Error {
  override name = "ExportCancelledError";
  constructor() {
    super("Export cancelled.");
  }
}

/** Renders the project to a video file at the project's frame rate. */
export async function exportProject(
  project: Project,
  files: MediaFiles,
  options: ExportOptions = {},
): Promise<Blob> {
  const { frameRate } = project.canvas;
  const width = options.width ?? project.canvas.width;
  const height = options.height ?? project.canvas.height;
  const format = CODECS[options.format ?? "mp4"];
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error("There's nothing on the timeline to export.");

  const quality = new Quality(options.quality ?? "very-high");
  const fps = frameRateToNumber(frameRate);

  const videoCodec = await getFirstEncodableVideoCodec([...format.video], {
    width,
    height,
    bitrate: options.videoBitrate ?? quality,
    frameRate: fps,
  });
  if (!videoCodec) {
    throw new Error(`This browser can't encode ${format.label} video at ${width}×${height}.`);
  }

  const hasAudio = options.audio !== undefined ? options.audio !== null : audibleClips(project, files).length > 0;
  const audioCodec = hasAudio
    ? await getFirstEncodableAudioCodec([...format.audio], {
        numberOfChannels: MIX_CHANNELS,
        sampleRate: MIX_SAMPLE_RATE,
        quality,
      })
    : null;
  if (hasAudio && !audioCodec) throw new Error(`This browser can't encode ${format.audio.join(" or ").toUpperCase()} audio.`);

  const canvas = new OffscreenCanvas(width, height);
  const compositor = new Compositor(canvas, { preserveDrawingBuffer: true });
  compositor.finish = options.finish ?? null;
  const renderer = new FrameRenderer(compositor);

  const output = new Output({
    format: options.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(
    canvas,
    options.videoBitrate ? { codec: videoCodec, bitrate: options.videoBitrate } : { codec: videoCodec, quality },
  );
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec && new AudioSampleSource({ codec: audioCodec, quality });
  if (audioSource) output.addAudioTrack(audioSource);

  const throwIfCancelled = () => {
    if (options.signal?.aborted) throw new ExportCancelledError();
  };

  const encodeAudio = async () => {
    if (!audioSource) return;
    const mix = options.audio ?? (await renderAudioMix(project, files, duration, options.signal));
    throwIfCancelled();
    const sample = new AudioSample({
      data: planar(mix),
      format: "f32-planar",
      numberOfChannels: mix.channels.length,
      sampleRate: mix.sampleRate,
      timestamp: 0,
    });
    await audioSource.add(sample);
    sample.close();
    audioSource.close();
  };

  const encodeVideo = async () => {
    const frameCount = microsToFrame(duration - 1, frameRate) + 1;
    for (let frame = 0; frame < frameCount; frame++) {
      throwIfCancelled();
      const start = frameToMicros(frame, frameRate);
      const end = frameToMicros(frame + 1, frameRate);
      await renderer.render(project, files, start);
      await videoSource.add(microsToSeconds(start), microsToSeconds(end - start));
      options.onProgress?.((frame + 1) / frameCount);
    }
    videoSource.close();
  };

  try {
    await output.start();
    // Feed both tracks at once so the muxer can interleave them as it goes.
    await Promise.all([encodeAudio(), encodeVideo()]);
    await output.finalize();
  } catch (error) {
    await output.cancel();
    // A cancel can surface as the browser's own AbortError; callers only need to know it was cancelled.
    if (options.signal?.aborted) throw new ExportCancelledError();
    throw error;
  } finally {
    await renderer.close();
    compositor.dispose();
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The export finished without producing a file.");
  return new Blob([buffer], { type: format.type });
}
