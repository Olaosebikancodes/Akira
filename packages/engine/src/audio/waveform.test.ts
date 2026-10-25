import { describe, expect, it } from "vitest";
import { accumulatePeaks, peakBetween } from "./waveform";

describe("accumulatePeaks", () => {
  it("keeps the loudest sample in each slot, ignoring sign", () => {
    const peaks = new Float32Array(3);
    accumulatePeaks(peaks, Float32Array.from([0.1, -0.5, 0.2, 0.3, -0.25, 0.9]), 0, 2);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.3);
    expect(peaks[2]).toBeCloseTo(0.9);
  });

  it("merges channels and buffers that start mid-slot", () => {
    const peaks = new Float32Array(3);
    accumulatePeaks(peaks, Float32Array.from([0.4, 0.4]), 0, 2);
    accumulatePeaks(peaks, Float32Array.from([0.6, 0.1]), 0.5, 2);
    expect(peaks[0]).toBeCloseTo(0.6);
    expect(peaks[1]).toBeCloseTo(0.1);
  });

  it("drops samples outside the waveform", () => {
    const peaks = new Float32Array(1);
    accumulatePeaks(peaks, Float32Array.from([1, 1, 1, 1]), -1, 2);
    expect(peaks[0]).toBe(1);
  });
});

describe("peakBetween", () => {
  it("finds the loudest peak in a stretch of source time", () => {
    const waveform = { rate: 100, start: 1_000_000, peaks: Float32Array.from([0.1, 0.2, 0.7, 0.3]) };
    expect(peakBetween(waveform, 1_000_000, 1_010_000)).toBeCloseTo(0.2);
    expect(peakBetween(waveform, 1_015_000, 1_030_000)).toBeCloseTo(0.7);
    // Entirely before the audio starts: nothing to show.
    expect(peakBetween(waveform, 0, 500_000)).toBe(0);
  });
});
