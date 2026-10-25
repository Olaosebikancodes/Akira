import { describe, expect, it } from "vitest";
import { SpectralGate } from "./spectral-gate";
import { WORKLET_SOURCE } from "./worklet";

describe("worklet source", () => {
  it("rebuilds a working SpectralGate from its embedded source", () => {
    const Gate = new Function(`return (${SpectralGate.toString()});`)() as typeof SpectralGate;
    const original = new SpectralGate(0.8);
    const copy = new Gate(0.8);
    const a = Float32Array.from({ length: 8192 }, (_, i) => Math.sin(i / 7) * 0.4 + ((i * 7919) % 13) / 130);
    const b = a.slice();
    original.process(a);
    copy.process(b);
    expect([...b]).toEqual([...a]);
  });

  it("registers the processor the nodes ask for", () => {
    expect(WORKLET_SOURCE).toContain('registerProcessor("akira-spectral-gate"');
  });
});
