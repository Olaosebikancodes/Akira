import type { Clip } from "../project/model";
import type { Micros } from "../time";
import { microsToSeconds } from "../time";
import { gainEnvelope } from "./envelope";
import { SpectralGate } from "./spectral-gate";
import { createSpectralGateNode } from "./worklet";

/** Rumble lives below this; voices start well above it. */
const RUMBLE_CUTOFF_HZ = 80;
/** Mains hum has strong harmonics, so the first four multiples are notched out. */
const HUM_HARMONICS = 4;
/** Narrow notches remove the hum without dulling nearby frequencies. */
const HUM_NOTCH_Q = 30;

export interface ClipChain {
  /** Where the clip's decoded audio goes in. */
  input: AudioNode;
  /** Seconds the chain delays its output by; audio must be started this much early. */
  latency: number;
}

/**
 * Builds a clip's sound path into `destination`: rumble cut, hum notches
 * and hiss reduction as the clip asks, then its volume and fades. Live
 * playback and the export mix both use this, so they sound the same.
 *
 * `timelineOrigin` is the context time at which timeline time zero plays,
 * and `from` is where playback starts, so a fade already under way begins
 * at the right level. Hiss reduction needs `loadAudioWorklets` first.
 */
export function connectClipChain(
  context: BaseAudioContext,
  destination: AudioNode,
  clip: Clip,
  timelineOrigin: number,
  from: Micros,
): ClipChain {
  const gain = context.createGain();
  const at = (time: Micros) => Math.max(0, timelineOrigin + microsToSeconds(time));
  const [first, ...rest] = gainEnvelope(clip, from);
  if (first) {
    gain.gain.setValueAtTime(first.gain, at(first.time));
    for (const point of rest) gain.gain.linearRampToValueAtTime(point.gain, at(point.time));
  }
  gain.connect(destination);

  // Built from the output backwards: each new node feeds the previous one.
  let input: AudioNode = gain;
  let latency = 0;
  const { denoise, hum, rumble } = clip.audioFilters;
  if (denoise > 0) {
    const gate = createSpectralGateNode(context, denoise);
    gate.connect(input);
    input = gate;
    latency = SpectralGate.LATENCY / context.sampleRate;
  }
  if (hum) {
    for (let harmonic = HUM_HARMONICS; harmonic >= 1; harmonic--) {
      const notch = context.createBiquadFilter();
      notch.type = "notch";
      notch.frequency.value = hum * harmonic;
      notch.Q.value = HUM_NOTCH_Q;
      notch.connect(input);
      input = notch;
    }
  }
  if (rumble) {
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = RUMBLE_CUTOFF_HZ;
    highpass.Q.value = Math.SQRT1_2;
    highpass.connect(input);
    input = highpass;
  }
  return { input, latency };
}
