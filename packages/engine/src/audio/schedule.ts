import type { AudioBufferSink } from "mediabunny";
import type { MediaFiles } from "../media/media-file";
import type { Clip, Project } from "../project/model";
import { isAudible } from "../project/query";
import { clipEnd, rateAt, toSourceTime, toTimelineTime } from "../project/timing";
import { type Micros, microsToSeconds, secondsToMicros } from "../time";
import { type AudioPlacement, placeAudioBuffer } from "./placement";

export interface AudibleClip {
  clip: Clip;
  sink: AudioBufferSink;
}

/**
 * Clips that make sound: audible clips whose audio can be decoded, on tracks
 * that aren't muted. While any track is soloed, only soloed tracks play.
 */
export function audibleClips(project: Project, files: MediaFiles): AudibleClip[] {
  const soloing = project.tracks.some((track) => track.solo);
  const result: AudibleClip[] = [];
  for (const track of project.tracks) {
    if (track.muted || (soloing && !track.solo)) continue;
    for (const clip of track.clips) {
      const sink = files.get(clip.assetId)?.audio;
      if (sink && isAudible(project, clip)) result.push({ clip, sink });
    }
  }
  return result;
}

export interface PlacedBuffer {
  buffer: AudioBuffer;
  placement: AudioPlacement;
}

/**
 * Decodes a clip's audio from timeline time `from` onwards, yielding each
 * buffer with where it plays. Clips that end before `from` yield nothing.
 */
export async function* clipAudio(
  { clip, sink }: AudibleClip,
  from: Micros,
): AsyncGenerator<PlacedBuffer, void, unknown> {
  if (clipEnd(clip) <= from) return;
  const sourceFrom = Math.max(clip.sourceIn, toSourceTime(clip, from));
  const buffers = sink.buffers(microsToSeconds(sourceFrom), microsToSeconds(clip.sourceOut));
  for await (const { buffer, timestamp, duration } of buffers) {
    const placement = placeAudioBuffer(
      clip,
      secondsToMicros(timestamp),
      secondsToMicros(duration),
      from,
    );
    if (placement) yield { buffer, placement };
  }
}

/**
 * Starts a node that plays a placed buffer. `timelineOrigin` is the context
 * time at which timeline time zero plays. A buffer that arrives late starts
 * part-way through instead of shifting, so audio stays in sync.
 */
export function playPlacedBuffer(
  context: BaseAudioContext,
  destination: AudioNode,
  { buffer, placement }: PlacedBuffer,
  clip: Clip,
  timelineOrigin: number,
): AudioBufferSourceNode | null {
  let at = placement.at;
  let offset = placement.offset;
  let duration = placement.duration;

  const late = secondsToMicros(context.currentTime - timelineOrigin) - at;
  if (late > 0) {
    const skipped = Math.round(late * rateAt(clip, at));
    at += late;
    offset += skipped;
    duration -= skipped;
    if (duration <= 0) return null;
  }

  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(destination);
  const when = timelineOrigin + microsToSeconds(at);
  if (clip.speedCurve) followCurve(node.playbackRate, clip, at, duration, when);
  else node.playbackRate.value = clip.speed;
  node.start(when, microsToSeconds(offset), microsToSeconds(duration));
  return node;
}

/** Rate samples per second of timeline when following a speed curve; Web Audio joins them with straight lines. */
const CURVE_RATE_SAMPLES = 100;

/**
 * Automates a node's playback rate along the clip's speed curve, so the
 * buffer plays through its footage exactly as fast as the picture does.
 */
function followCurve(rate: AudioParam, clip: Clip, at: Micros, duration: Micros, when: number): void {
  // `duration` is source time: how much of the buffer plays, starting at timeline time `at`.
  const span = toTimelineTime(clip, toSourceTime(clip, at) + duration) - at;
  if (span <= 0) {
    rate.value = rateAt(clip, at);
    return;
  }
  const count = Math.max(2, Math.ceil(microsToSeconds(span) * CURVE_RATE_SAMPLES) + 1);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) values[i] = rateAt(clip, at + (span * i) / (count - 1));
  rate.setValueCurveAtTime(values, when, microsToSeconds(span));
}
