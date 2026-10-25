import type { MediaFiles } from "../media/media-file";
import type { Project } from "../project/model";
import { type Micros, microsToSeconds } from "../time";
import { audibleClips, clipAudio, playPlacedBuffer } from "./schedule";

export const MIX_SAMPLE_RATE = 48_000;
export const MIX_CHANNELS = 2;

/**
 * Renders the whole timeline's audio into one stereo buffer, faster than real
 * time. It uses the same placement and scheduling as live playback, so the
 * export sounds exactly like the preview.
 */
export async function renderAudioMix(
  project: Project,
  files: MediaFiles,
  duration: Micros,
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext({
    numberOfChannels: MIX_CHANNELS,
    sampleRate: MIX_SAMPLE_RATE,
    length: Math.max(1, Math.ceil(microsToSeconds(duration) * MIX_SAMPLE_RATE)),
  });

  for (const clip of audibleClips(project, files)) {
    for await (const placed of clipAudio(clip, 0)) {
      playPlacedBuffer(context, context.destination, placed, clip.clip.speed, 0);
    }
  }

  return context.startRendering();
}
