import type { MediaFile } from "../media/media-file";
import { type Micros, microsToSeconds } from "../time";

/** Peaks per second of source: enough detail for the timeline's closest zoom. */
export const WAVEFORM_RATE = 100;

export interface Waveform {
  /** Peaks per second of source. */
  rate: number;
  /** Source time of the first peak. */
  start: Micros;
  /** The loudest sample in each slot, 0 to 1, across all channels. */
  peaks: Float32Array;
}

/** Decodes a file's audio once and records the loudest sample in each slot. */
export async function computeWaveform(file: MediaFile, rate: number = WAVEFORM_RATE): Promise<Waveform | null> {
  if (!file.audio) return null;
  const { start, duration } = file.info;
  const peaks = new Float32Array(Math.ceil(microsToSeconds(duration) * rate) + 1);
  for await (const { buffer, timestamp } of file.audio.buffers(microsToSeconds(start))) {
    const firstSlot = (timestamp - microsToSeconds(start)) * rate;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      accumulatePeaks(peaks, buffer.getChannelData(channel), firstSlot, buffer.sampleRate / rate);
    }
  }
  return { rate, start, peaks };
}

/**
 * Raises each slot's peak to the loudest sample landing in it. `firstSlot`
 * is where the first sample falls, and may be fractional.
 */
export function accumulatePeaks(
  peaks: Float32Array,
  samples: Float32Array,
  firstSlot: number,
  samplesPerSlot: number,
): void {
  for (let i = 0; i < samples.length; i++) {
    const slot = Math.floor(firstSlot + i / samplesPerSlot);
    if (slot < 0 || slot >= peaks.length) continue;
    const value = Math.abs(samples[i]!);
    if (value > peaks[slot]!) peaks[slot] = value;
  }
}

/** The loudest peak across a stretch of source time, for drawing one column of a waveform. */
export function peakBetween(waveform: Waveform, from: Micros, to: Micros): number {
  const first = Math.max(0, Math.floor(microsToSeconds(from - waveform.start) * waveform.rate));
  const last = Math.min(waveform.peaks.length - 1, Math.ceil(microsToSeconds(to - waveform.start) * waveform.rate));
  let peak = 0;
  for (let slot = first; slot <= last; slot++) peak = Math.max(peak, waveform.peaks[slot]!);
  return peak;
}
