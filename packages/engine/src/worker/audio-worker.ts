import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import type { MediaFiles } from "../media/media-file";
import type { Id } from "../project/model";
import { type Micros, microsToSeconds } from "../time";
import type { WorkerScope } from "./render-worker";

/** How much decoded sound the worker keeps ready beyond what playback has taken. */
const DECODE_AHEAD: Micros = 3_000_000;

type AudioRequest =
  | { type: "files"; add: { assetId: Id; file: File }[]; remove: Id[] }
  | { type: "stream"; id: number; assetId: Id; start: Micros; end: Micros }
  | { type: "consumed"; id: number; until: Micros }
  | { type: "cancel"; id: number };

type AudioEvent =
  | { type: "chunk"; id: number; timestamp: Micros; sampleRate: number; channels: Float32Array[] }
  | { type: "end"; id: number }
  | { type: "error"; id: number; message: string };

interface Stream {
  samples: AsyncGenerator<import("mediabunny").AudioSample, void, unknown>;
  /** How far playback has taken sound from this stream. */
  consumed: Micros;
  decodedUntil: Micros;
  running: boolean;
  cancelled: boolean;
}

/**
 * Decodes sound for live playback in a worker. The page only turns the
 * finished PCM into AudioBuffers and schedules them, so a busy editor can no
 * longer starve the decoder and cut the sound out. AudioBuffer doesn't exist
 * in workers, so samples travel as plain Float32Arrays.
 */
export function serveAudioWorker(scope: WorkerScope): void {
  const sources = new Map<Id, Promise<AudioSampleSink | null>>();
  const inputs = new Map<Id, Input>();
  const streams = new Map<number, Stream>();
  const post = (event: AudioEvent, transfer: Transferable[] = []) =>
    (scope as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(event, transfer);

  async function pump(id: number, stream: Stream): Promise<void> {
    if (stream.running) return;
    stream.running = true;
    try {
      while (!stream.cancelled && stream.decodedUntil < stream.consumed + DECODE_AHEAD) {
        const next = await stream.samples.next();
        if (stream.cancelled) return;
        if (next.done) {
          post({ type: "end", id });
          streams.delete(id);
          return;
        }
        const sample = next.value;
        const channels = Array.from({ length: sample.numberOfChannels }, (_, plane) => {
          const data = new Float32Array(sample.numberOfFrames);
          sample.copyTo(data, { planeIndex: plane, format: "f32-planar" });
          return data;
        });
        stream.decodedUntil = sample.microsecondTimestamp + sample.microsecondDuration;
        post(
          { type: "chunk", id, timestamp: sample.microsecondTimestamp, sampleRate: sample.sampleRate, channels },
          channels.map((channel) => channel.buffer),
        );
        sample.close();
      }
    } catch (error) {
      post({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
      streams.delete(id);
    } finally {
      stream.running = false;
    }
  }

  scope.addEventListener("message", (event: MessageEvent<AudioRequest>) => {
    const message = event.data;
    switch (message.type) {
      case "files":
        for (const assetId of message.remove) {
          inputs.get(assetId)?.dispose();
          inputs.delete(assetId);
          sources.delete(assetId);
        }
        for (const { assetId, file } of message.add) {
          sources.set(
            assetId,
            (async () => {
              const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
              inputs.set(assetId, input);
              const track = await input.getPrimaryAudioTrack();
              return track && (await track.canDecode()) ? new AudioSampleSink(track) : null;
            })(),
          );
        }
        break;
      case "stream":
        void (async () => {
          const sink = await sources.get(message.assetId);
          if (!sink) return post({ type: "end", id: message.id });
          const stream: Stream = {
            samples: sink.samples(microsToSeconds(message.start), microsToSeconds(message.end)),
            consumed: message.start,
            decodedUntil: message.start,
            running: false,
            cancelled: false,
          };
          streams.set(message.id, stream);
          await pump(message.id, stream);
        })();
        break;
      case "consumed": {
        const stream = streams.get(message.id);
        if (!stream) break;
        stream.consumed = Math.max(stream.consumed, message.until);
        void pump(message.id, stream);
        break;
      }
      case "cancel": {
        const stream = streams.get(message.id);
        if (!stream) break;
        stream.cancelled = true;
        streams.delete(message.id);
        void stream.samples.return();
        break;
      }
    }
  });
}

/** Decoded sound from the worker: a sample's start in source time, and its channels. */
export interface AudioChunk {
  timestamp: Micros;
  sampleRate: number;
  channels: Float32Array[];
}

/** One stream of decoded sound, read with `for await`. Tell it what's been used so it decodes further. */
export interface AudioChunkStream extends AsyncIterableIterator<AudioChunk> {
  consumed(until: Micros): void;
}

/**
 * The page's side of the audio worker: keeps it supplied with the files
 * that make sound, and opens streams of decoded chunks from them.
 */
export class WorkerAudioFeed {
  private nextId = 1;
  private readonly sent = new Set<Id>();
  private readonly streams = new Map<number, (event: AudioEvent) => void>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", (event: MessageEvent<AudioEvent>) => this.streams.get(event.data.id)?.(event.data));
  }

  /** Sends the worker its own copy of every file that has sound, and forgets removed ones. */
  setFiles(files: MediaFiles): void {
    const add: { assetId: Id; file: File }[] = [];
    for (const [assetId, media] of files) {
      if (!media.audio || this.sent.has(assetId)) continue;
      add.push({ assetId, file: media.file });
      this.sent.add(assetId);
    }
    const remove = [...this.sent].filter((assetId) => !files.has(assetId));
    for (const assetId of remove) this.sent.delete(assetId);
    if (add.length > 0 || remove.length > 0) this.worker.postMessage({ type: "files", add, remove } satisfies AudioRequest);
  }

  /** Decoded sound of an asset from `start` to `end`, in its own time. */
  stream(assetId: Id, start: Micros, end: Micros): AudioChunkStream {
    const id = this.nextId++;
    const queue: AudioChunk[] = [];
    let waiting: ((result: IteratorResult<AudioChunk>) => void) | null = null;
    let failure: ((error: Error) => void) | null = null;
    let finished = false;
    let error: Error | null = null;

    const close = () => {
      this.streams.delete(id);
      if (!finished) this.worker.postMessage({ type: "cancel", id } satisfies AudioRequest);
      finished = true;
    };
    this.streams.set(id, (event) => {
      if (event.type === "chunk") queue.push(event);
      else if (event.type === "end") finished = true;
      else error = new Error(event.message);
      if (event.type !== "chunk") this.streams.delete(id);
      if (!waiting) return;
      const resolve = waiting;
      const reject = failure!;
      waiting = null;
      failure = null;
      if (queue.length > 0) resolve({ value: queue.shift()!, done: false });
      else if (error) reject(error);
      else if (finished) resolve({ value: undefined, done: true });
    });
    this.worker.postMessage({ type: "stream", id, assetId, start, end } satisfies AudioRequest);

    const stream: AudioChunkStream = {
      next: () => {
        if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
        if (error) return Promise.reject(error);
        if (finished) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => {
          waiting = resolve;
          failure = reject;
        });
      },
      return: () => {
        close();
        return Promise.resolve({ value: undefined, done: true });
      },
      consumed: (until) => {
        if (!finished) this.worker.postMessage({ type: "consumed", id, until } satisfies AudioRequest);
      },
      [Symbol.asyncIterator]() {
        return stream;
      },
    };
    return stream;
  }

  dispose(): void {
    this.worker.terminate();
  }
}
