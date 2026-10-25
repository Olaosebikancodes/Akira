import type { AudioBufferSink } from "mediabunny";
import type { MediaFiles } from "../media/media-file";
import type { Clip, Project } from "../project/model";
import { isAudible } from "../project/query";
import { clipEnd, toSourceTime } from "../project/timing";
import { type Micros, microsToSeconds, secondsToMicros } from "../time";
import { type AudioPlacement, placeAudioBuffer } from "./placement";

export interface AudibleClip {
  clip: Clip;
  sink: AudioBufferSink;
}

/** Clips that make sound: audible clips on unmuted tracks whose audio can be decoded. */
export function audibleClips(project: Project, files: MediaFiles): AudibleClip[] {
  const result: AudibleClip[] = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
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
  speed: number,
  timelineOrigin: number,
): AudioBufferSourceNode | null {
  let when = timelineOrigin + microsToSeconds(placement.at);
  let offset = microsToSeconds(placement.offset);
  let duration = microsToSeconds(placement.duration);

  const late = context.currentTime - when;
  if (late > 0) {
    when += late;
    offset += late * speed;
    duration -= late * speed;
    if (duration <= 0) return null;
  }

  const node = context.createBufferSource();
  node.buffer = buffer;
  node.playbackRate.value = speed;
  node.connect(destination);
  node.start(when, offset, duration);
  return node;
}
