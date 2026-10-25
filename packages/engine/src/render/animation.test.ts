import { describe, expect, it } from "vitest";
import { createClip } from "../project/create";
import { IMAGE } from "../project/fixtures.test-util";
import type { Clip, ClipAnimation } from "../project/model";
import { animatedLook } from "./animation";

const S = 1_000_000;

function animated(animation: Partial<ClipAnimation>): Clip {
  return { ...createClip(IMAGE, 0), sourceOut: 4 * S, animation: { in: null, out: null, loop: null, ...animation } };
}

describe("animatedLook", () => {
  it("leaves clips without animation alone", () => {
    const clip = createClip(IMAGE, 0);
    expect(animatedLook(clip, S)).toEqual({ transform: clip.transform, reveal: 1 });
  });

  it("fades in from invisible and out to invisible", () => {
    const clip = animated({ in: { kind: "fade", duration: S }, out: { kind: "fade", duration: S } });
    expect(animatedLook(clip, 0).transform.opacity).toBe(0);
    expect(animatedLook(clip, S / 2).transform.opacity).toBeCloseTo(0.875);
    expect(animatedLook(clip, 2 * S).transform.opacity).toBe(1);
    expect(animatedLook(clip, 4 * S).transform.opacity).toBe(0);
  });

  it("slides up into place", () => {
    const clip = animated({ in: { kind: "slide-up", duration: S } });
    expect(animatedLook(clip, 0).transform.y).toBeCloseTo(0.08);
    expect(animatedLook(clip, S).transform.y).toBe(0);
  });

  it("pops in from smaller, overshooting slightly", () => {
    const clip = animated({ in: { kind: "pop", duration: S } });
    expect(animatedLook(clip, 0).transform.scale).toBeCloseTo(0.6);
    const peak = Math.max(...[0.6, 0.7, 0.8, 0.9].map((t) => animatedLook(clip, t * S).transform.scale));
    expect(peak).toBeGreaterThan(1);
    expect(animatedLook(clip, S).transform.scale).toBeCloseTo(1);
  });

  it("types text out over the in duration", () => {
    const clip = animated({ in: { kind: "typewriter", duration: 2 * S } });
    expect(animatedLook(clip, 0).reveal).toBe(0);
    expect(animatedLook(clip, S).reveal).toBe(0.5);
    expect(animatedLook(clip, 3 * S).reveal).toBe(1);
  });

  it("loops for the clip's whole length", () => {
    const clip = animated({ loop: { kind: "pulse", period: S } });
    expect(animatedLook(clip, S / 4).transform.scale).toBeCloseTo(1.06);
    expect(animatedLook(clip, (5 * S) / 4).transform.scale).toBeCloseTo(1.06);
    expect(animatedLook(clip, S / 2).transform.scale).toBeCloseTo(1);
  });
});

describe("shake", () => {
  const shaking = (amount: number): Clip => ({ ...createClip(IMAGE, 0), sourceOut: 4 * S, effects: [{ kind: "shake", amount }] });

  it("moves the clip around and zooms in to hide the edges", () => {
    const clip = shaking(1);
    const positions = [0.1, 0.2, 0.3, 0.4].map((t) => animatedLook(clip, t * S).transform);
    expect(new Set(positions.map((p) => p.x.toFixed(4))).size).toBeGreaterThan(1);
    for (const p of positions) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.02);
      expect(p.scale).toBeCloseTo(1.06);
    }
  });

  it("is the same every time it's played", () => {
    const clip = shaking(0.5);
    expect(animatedLook(clip, 0.7 * S)).toEqual(animatedLook(clip, 0.7 * S));
  });

  it("does nothing at zero", () => {
    const clip = shaking(0);
    expect(animatedLook(clip, S).transform).toEqual(clip.transform);
  });
});
