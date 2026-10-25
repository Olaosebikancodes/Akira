import { describe, expect, it } from "vitest";
import { SpectralGate } from "./spectral-gate";

const RATE = 48_000;
const LATENCY = SpectralGate.LATENCY;

/** Deterministic white noise, so the tests don't flake. */
function noise(length: number, amplitude: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    out[i] = ((state / 2 ** 32) * 2 - 1) * amplitude;
  }
  return out;
}

function sine(length: number, frequency: number, amplitude: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE));
}

function add(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((value, i) => value + b[i]!);
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! ** 2;
  return Math.sqrt(sum / (to - from));
}

/** Runs a signal through the gate in the 128-sample blocks an AudioWorklet uses. */
function gate(signal: Float32Array, strength: number): Float32Array {
  const gateInstance = new SpectralGate(strength);
  const out = signal.slice();
  for (let i = 0; i < out.length; i += 128) gateInstance.process(out.subarray(i, i + 128));
  return out;
}

describe("SpectralGate", () => {
  it("passes audio through unchanged, just delayed, at strength 0", () => {
    const input = add(sine(RATE, 440, 0.5), noise(RATE, 0.05));
    const output = gate(input, 0);
    // Past the start-up frames, the output is the input shifted by the latency.
    let worst = 0;
    for (let i = 4 * SpectralGate.FRAME; i < RATE; i++) {
      worst = Math.max(worst, Math.abs(output[i]! - input[i - LATENCY]!));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("turns steady hiss right down", () => {
    const input = noise(RATE * 2, 0.1);
    const output = gate(input, 1);
    // Judge the second half, once the noise floor has settled.
    expect(rms(output, RATE, RATE * 2)).toBeLessThan(rms(input) * 0.3);
  });

  it("keeps speech-like bursts while quieting the gaps between them", () => {
    // 300 ms of tone, 200 ms of gap, repeated, like syllables over room hiss.
    const length = RATE * 3;
    const bursts = sine(length, 1_000, 0.3).map((value, i) => ((i / RATE) % 0.5 < 0.3 ? value : 0));
    const hiss = noise(length, 0.05, 7);
    const output = gate(add(bursts, hiss), 1);

    // Measure the second half of the clip, aligning output with input by the latency.
    let toneIn = 0;
    let toneOut = 0;
    let gapIn = 0;
    let gapOut = 0;
    let gapCount = 0;
    let toneCount = 0;
    for (let i = RATE * 1.5; i < length; i++) {
      const phase = ((i - LATENCY) / RATE) % 0.5;
      // Skip the edges of each burst, where any gate must ramp.
      if (phase > 0.03 && phase < 0.27) {
        toneIn += bursts[i - LATENCY]! ** 2;
        toneOut += output[i]! ** 2;
        toneCount++;
      } else if (phase > 0.33 && phase < 0.47) {
        gapIn += hiss[i - LATENCY]! ** 2;
        gapOut += output[i]! ** 2;
        gapCount++;
      }
    }
    expect(Math.sqrt(toneOut / toneCount)).toBeGreaterThan(Math.sqrt(toneIn / toneCount) * 0.85);
    expect(Math.sqrt(gapOut / gapCount)).toBeLessThan(Math.sqrt(gapIn / gapCount) * 0.3);
  });
});
