import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  StreamTarget,
  type StreamTargetChunk,
  VideoSample,
  type VideoSampleInit,
  VideoSampleSink,
  VideoSampleSource,
} from "mediabunny";
import { type Micros, microsToSeconds } from "../time";
import { throwIfCancelled } from "./cancel";

export interface ReverseOptions {
  /** The part of the file to reverse, in its own time. */
  start: Micros;
  end: Micros;
  signal?: AbortSignal;
  /** 0 to 1. */
  onProgress?: (progress: number) => void;
  /** Where to write the MP4; it's kept in memory and returned when left out. */
  target?: WritableStream<StreamTargetChunk>;
}

/**
 * Decoders only run forwards, so the range is read in short chunks from the
 * end: each chunk is decoded and copied out, then written last frame first.
 * Only one chunk of frames is ever held in memory.
 */
const CHUNK: Micros = 500_000;
/** Frequent keyframes keep the reversed copy quick to scrub through. */
const KEYFRAME_INTERVAL = 0.5;

/**
 * Writes the part of `file` between `start` and `end` backwards as a new
 * MP4, video and sound both. Time t in the result is time `end - t` in the
 * original. Returns the file when no `target` was given.
 */
export async function reverseMedia(file: Blob, options: ReverseOptions): Promise<Blob | null> {
  const { start, end, signal, onProgress } = options;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const target = options.target ? new StreamTarget(options.target, { chunked: true }) : new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });

    const video = videoTrack && (await videoTrack.canDecode()) ? new VideoSampleSink(videoTrack) : null;
    const videoSource = video && new VideoSampleSource({ codec: "avc", quality: QUALITY_VERY_HIGH, keyFrameInterval: KEYFRAME_INTERVAL });
    if (videoTrack && videoSource) {
      output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation(), flip: await videoTrack.getFlip() });
    }

    const audio = audioTrack && (await audioTrack.canDecode()) ? new AudioSampleSink(audioTrack) : null;
    const audioCodec = (await canEncodeAudio("aac")) ? "aac" : "opus";
    const audioSource = audio && new AudioSampleSource({ codec: audioCodec, quality: QUALITY_HIGH });
    if (audioSource) output.addAudioTrack(audioSource);
    if (!videoSource && !audioSource) throw new Error("This file has nothing Akira can reverse.");

    /** Runs `work` on each chunk from the end backwards, stopping if cancelled. */
    const eachChunk = async (work: (chunkStart: Micros, chunkEnd: Micros) => Promise<void>, reports: boolean) => {
      for (let chunkEnd = end; chunkEnd > start; chunkEnd -= CHUNK) {
        throwIfCancelled(signal, "Reversing was cancelled.");
        const chunkStart = Math.max(start, chunkEnd - CHUNK);
        await work(chunkStart, chunkEnd);
        if (reports) onProgress?.((end - chunkStart) / (end - start));
      }
    };

    await output.start();
    try {
      // The muxer interleaves the tracks, so it waits for both to move forward;
      // feeding them one after the other would leave it waiting forever.
      await Promise.all([
        video && videoSource
          ? eachChunk((from, to) => reverseVideoChunk(video, videoSource, from, to, start, end), true).then(() => videoSource.close())
          : null,
        audio && audioSource
          ? eachChunk((from, to) => reverseAudioChunk(audio, audioSource, from, to, end), !videoSource).then(() => audioSource.close())
          : null,
      ]);
      await output.finalize();
    } catch (error) {
      await output.cancel();
      throw error;
    }
    return target instanceof BufferTarget ? new Blob([target.buffer!], { type: "video/mp4" }) : null;
  } finally {
    input.dispose();
  }
}

async function reverseVideoChunk(
  sink: VideoSampleSink,
  source: VideoSampleSource,
  chunkStart: Micros,
  chunkEnd: Micros,
  start: Micros,
  end: Micros,
): Promise<void> {
  const frames: CopiedFrame[] = [];
  for await (const sample of sink.samples(microsToSeconds(chunkStart), microsToSeconds(chunkEnd))) {
    // The frame already showing when a chunk starts belongs to the chunk before it,
    // except at the very start of the range.
    const keep = sample.microsecondTimestamp >= chunkStart || chunkStart <= start;
    if (keep) frames.push(await copyFrame(sample));
    sample.close();
  }
  for (let frame = frames.pop(); frame; frame = frames.pop()) {
    const from = Math.max(start, frame.timestamp);
    const to = Math.min(end, frame.timestamp + frame.duration);
    const reversed = new VideoSample(frame.data, {
      ...frame.init,
      timestamp: microsToSeconds(end - to),
      duration: microsToSeconds(Math.max(1, to - from)),
    });
    await source.add(reversed);
    reversed.close();
  }
}

interface CopiedFrame {
  data: Uint8Array<ArrayBuffer>;
  init: Omit<VideoSampleInit, "timestamp" | "duration"> & Required<Pick<VideoSampleInit, "format" | "codedWidth" | "codedHeight">>;
  timestamp: Micros;
  duration: Micros;
}

/**
 * Copies a decoded frame into ordinary memory. Hardware decoders have a
 * small, fixed pool of frames and stop when every one is held, so a chunk's
 * frames can't wait in the decoder's own memory to be written in reverse.
 */
async function copyFrame(sample: VideoSample): Promise<CopiedFrame> {
  // Frames in a format WebCodecs can't name are converted to plain RGBA.
  const options = sample.format ? undefined : { format: "RGBA" as const };
  const data = new Uint8Array(sample.allocationSize(options));
  const layout = await sample.copyTo(data, options);
  return {
    data,
    init: {
      format: sample.format ?? "RGBA",
      codedWidth: options ? sample.visibleRect.width : sample.codedWidth,
      codedHeight: options ? sample.visibleRect.height : sample.codedHeight,
      ...(options ? {} : { visibleRect: sample.visibleRect }),
      layout,
      colorSpace: sample.colorSpace,
      rotation: sample.rotation,
      flip: sample.flip,
    },
    timestamp: sample.microsecondTimestamp,
    duration: sample.microsecondDuration,
  };
}

async function reverseAudioChunk(
  sink: AudioSampleSink,
  source: AudioSampleSource,
  chunkStart: Micros,
  chunkEnd: Micros,
  end: Micros,
): Promise<void> {
  let sampleRate = 0;
  let channelCount = 0;
  const pieces: Float32Array[][] = [];
  for await (const sample of sink.samples(microsToSeconds(chunkStart), microsToSeconds(chunkEnd))) {
    sampleRate = sample.sampleRate;
    channelCount = sample.numberOfChannels;
    // Keep only the frames inside the chunk; a sample can straddle its edges.
    const first = Math.max(0, Math.ceil(microsToSeconds(chunkStart - sample.microsecondTimestamp) * sampleRate));
    const last = Math.min(sample.numberOfFrames, Math.ceil(microsToSeconds(chunkEnd - sample.microsecondTimestamp) * sampleRate));
    if (last > first) {
      const channels: Float32Array[] = [];
      for (let channel = 0; channel < channelCount; channel++) {
        const plane = new Float32Array(sample.numberOfFrames);
        sample.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
        channels.push(plane.subarray(first, last));
      }
      pieces.push(channels);
    }
    sample.close();
  }
  if (pieces.length === 0) return;

  const frames = pieces.reduce((sum, piece) => sum + piece[0]!.length, 0);
  const data = new Float32Array(frames * channelCount);
  for (let channel = 0; channel < channelCount; channel++) {
    // Planar layout: each channel's frames together, written last frame first.
    const plane = data.subarray(channel * frames, (channel + 1) * frames);
    let at = frames;
    for (const piece of pieces) {
      const samples = piece[channel]!;
      for (let i = 0; i < samples.length; i++) plane[--at] = samples[i]!;
    }
  }
  const reversed = new AudioSample({
    data,
    format: "f32-planar",
    numberOfChannels: channelCount,
    sampleRate,
    timestamp: microsToSeconds(end - chunkEnd),
  });
  await source.add(reversed);
  reversed.close();
}
