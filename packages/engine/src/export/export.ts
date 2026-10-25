import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
  type QualityLevel,
} from "mediabunny";
import { MIX_CHANNELS, MIX_SAMPLE_RATE, renderAudioMix } from "../audio/mix";
import { audibleClips } from "../audio/schedule";
import type { MediaFiles } from "../media/media-file";
import { projectDuration } from "../project/create";
import type { Project } from "../project/model";
import { Compositor } from "../render/compositor";
import { FrameRenderer } from "../render/frame-renderer";
import { frameRateToNumber, frameToMicros, microsToFrame, microsToSeconds } from "../time";

export interface ExportOptions {
  /** Encoder quality. Defaults to "very-high", for a final render. */
  quality?: QualityLevel;
  /** Called after each video frame with progress from 0 to 1. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export class ExportCancelledError extends Error {
  override name = "ExportCancelledError";
  constructor() {
    super("Export cancelled.");
  }
}

/** Renders the project to an H.264/AAC MP4 at the project's size and frame rate. */
export async function exportProject(
  project: Project,
  files: MediaFiles,
  options: ExportOptions = {},
): Promise<Blob> {
  const { width, height, frameRate } = project.canvas;
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error("There's nothing on the timeline to export.");

  const quality = new Quality(options.quality ?? "very-high");
  const fps = frameRateToNumber(frameRate);

  const videoCodec = await getFirstEncodableVideoCodec(["avc"], {
    width,
    height,
    quality,
    frameRate: fps,
  });
  if (!videoCodec) {
    throw new Error(`This browser can't encode H.264 video at ${width}×${height}.`);
  }

  const hasAudio = audibleClips(project, files).length > 0;
  const audioCodec = hasAudio
    ? await getFirstEncodableAudioCodec(["aac", "opus"], {
        numberOfChannels: MIX_CHANNELS,
        sampleRate: MIX_SAMPLE_RATE,
        quality,
      })
    : null;
  if (hasAudio && !audioCodec) throw new Error("This browser can't encode AAC or Opus audio.");

  const canvas = new OffscreenCanvas(width, height);
  const compositor = new Compositor(canvas, { preserveDrawingBuffer: true });
  const renderer = new FrameRenderer(compositor);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec && new AudioBufferSource({ codec: audioCodec, quality });
  if (audioSource) output.addAudioTrack(audioSource);

  const throwIfCancelled = () => {
    if (options.signal?.aborted) throw new ExportCancelledError();
  };

  const encodeAudio = async () => {
    if (!audioSource) return;
    const mix = await renderAudioMix(project, files, duration);
    throwIfCancelled();
    await audioSource.add(mix);
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
    throw error;
  } finally {
    await renderer.close();
    compositor.dispose();
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The export finished without producing a file.");
  return new Blob([buffer], { type: "video/mp4" });
}
