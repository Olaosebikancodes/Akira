import type { MediaFiles } from "../media/media-file";
import type { Project } from "../project/model";
import { type Micros, microsToSeconds } from "../time";
import { connectClipChain } from "./chain";
import type { PcmAudio } from "./pcm";
import { audibleClips, clipAudio, playPlacedBuffer } from "./schedule";
import { loadAudioWorklets } from "./worklet";

export const MIX_SAMPLE_RATE = 48_000;
export const MIX_CHANNELS = 2;

/**
 * Silence rendered before the timeline starts, so clips whose filters delay
 * their output (hiss reduction) can begin early even at time zero.
 */
const PREROLL_SECONDS = 0.05;

/**
 * Renders the whole timeline's audio to stereo PCM, faster than real time.
 * It uses the same placement, filters and fades as live playback, so the
 * export sounds exactly like the preview.
 */
export async function renderAudioMix(project: Project, files: MediaFiles, duration: Micros): Promise<PcmAudio> {
  const length = Math.max(1, Math.ceil(microsToSeconds(duration) * MIX_SAMPLE_RATE));
  const preroll = Math.round(PREROLL_SECONDS * MIX_SAMPLE_RATE);
  const context = new OfflineAudioContext({
    numberOfChannels: MIX_CHANNELS,
    sampleRate: MIX_SAMPLE_RATE,
    length: length + preroll,
  });
  await loadAudioWorklets(context);

  for (const clip of audibleClips(project, files)) {
    const chain = connectClipChain(context, context.destination, clip.clip, PREROLL_SECONDS, 0);
    for await (const placed of clipAudio(clip, 0)) {
      playPlacedBuffer(context, chain.input, placed, clip.clip.speed, PREROLL_SECONDS - chain.latency);
    }
  }

  const rendered = await context.startRendering();
  return {
    sampleRate: MIX_SAMPLE_RATE,
    channels: Array.from({ length: MIX_CHANNELS }, (_, i) => rendered.getChannelData(i).slice(preroll, preroll + length)),
  };
}
