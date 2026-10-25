import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  VideoSampleSink,
} from "mediabunny";
import type { Asset, Id } from "../project/model";
import { FPS_30, type FrameRate, frameRateFromNumber, secondsToMicros } from "../time";

export class UnsupportedMediaError extends Error {
  override name = "UnsupportedMediaError";
}

/** Opened media files, keyed by asset id. */
export type MediaFiles = ReadonlyMap<Id, MediaFile>;

/** What probing a file tells us: everything an asset needs except its id. */
export type MediaInfo = Omit<Asset, "id">;

const CODEC_NAMES: Record<string, string> = {
  avc: "H.264",
  hevc: "HEVC (H.265)",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  aac: "AAC",
  opus: "Opus",
  mp3: "MP3",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "Dolby Digital (AC-3)",
  eac3: "Dolby Digital Plus (E-AC-3)",
};

/**
 * An opened media file: what it contains, plus the decoders that read it.
 * Keep one per asset while the asset is in use; `dispose` releases the
 * decoders and the file handle.
 */
export class MediaFile {
  private constructor(
    private readonly input: Input,
    readonly info: MediaInfo,
    readonly video: VideoSampleSink | null,
    readonly audio: AudioBufferSink | null,
    /** Problems that don't stop the file from being used, for the UI to show. */
    readonly warnings: readonly string[],
  ) {}

  static async open(file: File): Promise<MediaFile> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      return await MediaFile.probe(input, file.name);
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  dispose(): void {
    this.input.dispose();
  }

  private static async probe(input: Input, name: string): Promise<MediaFile> {
    if (!(await input.canRead())) {
      throw new UnsupportedMediaError(
        `${name} isn't a video or audio format Akira can read.`,
      );
    }

    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    const warnings: string[] = [];

    if (videoTrack && !(await videoTrack.canDecode())) {
      throw new UnsupportedMediaError(
        `This browser can't decode ${await codecName(videoTrack)} video, so ${name} can't be used.`,
      );
    }

    let usableAudio: InputAudioTrack | null = null;
    if (audioTrack) {
      if (await audioTrack.canDecode()) {
        usableAudio = audioTrack;
      } else {
        warnings.push(
          `This browser can't decode ${await codecName(audioTrack)} audio, so ${name} will be silent.`,
        );
      }
    }

    if (!videoTrack && !usableAudio) {
      throw new UnsupportedMediaError(`${name} has no video or audio Akira can use.`);
    }

    const tracks = [videoTrack, usableAudio].filter((track) => track !== null);
    const [firstTimestamp, endTimestamp] = await Promise.all([
      input.getFirstTimestamp(tracks),
      input.computeDuration(tracks),
    ]);
    // Frames that end before zero are never shown, so playback starts at zero.
    const start = secondsToMicros(Math.max(0, firstTimestamp));

    const info: MediaInfo = {
      kind: videoTrack ? "video" : "audio",
      name,
      start,
      duration: secondsToMicros(endTimestamp) - start,
    };
    if (videoTrack) info.video = await describeVideo(videoTrack);
    if (usableAudio) {
      info.audio = {
        sampleRate: await usableAudio.getSampleRate(),
        channels: await usableAudio.getNumberOfChannels(),
      };
    }

    return new MediaFile(
      input,
      info,
      videoTrack && new VideoSampleSink(videoTrack),
      usableAudio && new AudioBufferSink(usableAudio),
      warnings,
    );
  }
}

async function describeVideo(track: InputVideoTrack): Promise<NonNullable<Asset["video"]>> {
  const [width, height, metrics] = await Promise.all([
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.computeFrameRateMetrics(),
  ]);
  return { width, height, frameRate: safeFrameRate(metrics.bestGuessFrameRate) };
}

/** A file with a single frame has no measurable rate; any rate works for it. */
function safeFrameRate(fps: number): FrameRate {
  return Number.isFinite(fps) && fps > 0 ? frameRateFromNumber(fps) : FPS_30;
}

async function codecName(track: InputVideoTrack | InputAudioTrack): Promise<string> {
  const codec = await track.getCodec();
  return codec ? (CODEC_NAMES[codec] ?? codec.toUpperCase()) : "this";
}
