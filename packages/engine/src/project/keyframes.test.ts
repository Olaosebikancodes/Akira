import { describe, expect, it } from "vitest";
import { clipGainAt, gainEnvelope } from "../audio/envelope";
import { animatedLook } from "../render/animation";
import { clearKeyframes, detachAudio, freezeFrame, setClipSpeed, setKeyframeEasing, setValuesAt, splitClip, toggleKeyframe, trimClip } from "./edit";
import { clip, IMAGE, projectWith, VIDEO } from "./fixtures.test-util";
import { ease, interpolate, isSilent, keyframeTimelineTime, keyframeTimes, propertyAt, transformAt } from "./keyframes";
import type { Easing, Keyframe, Project } from "./model";
import { findClip, isAudible } from "./query";

const S = 1_000_000;

function keys(...points: [number, number, Easing?][]): Keyframe[] {
  return points.map(([time, value, easing]) => ({ time, value, easing: easing ?? "linear" }));
}

/** A 4 s video clip at 2 s on the timeline, whose x runs from 0 to 1 over its first two seconds. */
function moving(): Project {
  return projectWith({
    clips: [clip("pad", VIDEO, 0, 2 * S), { ...clip("a", VIDEO, 2 * S, 4 * S, S), keyframes: { x: keys([S, 0], [3 * S, 1]) } }],
  });
}

describe("ease", () => {
  it("starts at 0 and ends at 1", () => {
    for (const easing of ["linear", "ease-in", "ease-out", "ease-in-out"] as const) {
      expect(ease(easing, 0)).toBe(0);
      expect(ease(easing, 1)).toBe(1);
    }
  });

  it("starts slow for ease-in and fast for ease-out", () => {
    expect(ease("ease-in", 0.5)).toBeLessThan(0.5);
    expect(ease("ease-out", 0.5)).toBeGreaterThan(0.5);
    expect(ease("ease-in-out", 0.5)).toBeCloseTo(0.5);
  });

  it("holds until the next keyframe", () => {
    expect(ease("hold", 0.99)).toBe(0);
  });
});

describe("interpolate", () => {
  const list = keys([S, 10], [2 * S, 20, "hold"], [3 * S, 40]);

  it("holds the first and last values outside the keyframes", () => {
    expect(interpolate(list, 0)).toBe(10);
    expect(interpolate(list, 9 * S)).toBe(40);
  });

  it("moves between keyframes with the earlier one's easing", () => {
    expect(interpolate(list, 1.5 * S)).toBe(15);
    expect(interpolate(list, 2.9 * S)).toBe(20);
    expect(interpolate(list, 3 * S)).toBe(40);
  });
});

describe("keyframed values", () => {
  it("follow the clip's own values when there are no keyframes", () => {
    const plain = clip("p", VIDEO, 0, S);
    expect(transformAt(plain, S / 2)).toBe(plain.transform);
    expect(propertyAt(plain, "volume", S / 2)).toBe(plain.volume);
  });

  it("are measured in source time, so they stay with the footage", () => {
    const a = findClip(moving(), "a")!;
    // Source 1 s plays at timeline 2 s; source 2 s at timeline 3 s.
    expect(transformAt(a, 2 * S).x).toBe(0);
    expect(transformAt(a, 3 * S).x).toBe(0.5);
    expect(keyframeTimelineTime(a, a.keyframes!.x![1]!)).toBe(4 * S);
  });

  it("stretch with the footage when the speed changes", () => {
    const fast = findClip(setClipSpeed(moving(), "a", 2), "a")!;
    expect(keyframeTimelineTime(fast, fast.keyframes!.x![1]!)).toBe(3 * S);
    expect(transformAt(fast, 2.5 * S).x).toBe(0.5);
  });

  it("stay on the same frames when the start is trimmed", () => {
    const trimmed = findClip(trimClip(moving(), "a", "start", 3 * S), "a")!;
    // The main track closes the gap, so the clip now starts at 2 s from source 2 s.
    expect(trimmed.start).toBe(2 * S);
    expect(transformAt(trimmed, 2 * S).x).toBe(0.5);
  });

  it("carry on across a split without a jump", () => {
    const { project, rightId } = splitClip(moving(), "a", 3 * S);
    const left = findClip(project, "a")!;
    const right = findClip(project, rightId!)!;
    expect(transformAt(left, 3 * S - 1)).toMatchObject({ x: expect.closeTo(0.5, 5) });
    expect(transformAt(right, 3 * S).x).toBe(0.5);
    expect(transformAt(right, 3.5 * S).x).toBe(0.75);
  });

  it("carry on across a split of a still, whose clock restarts", () => {
    const still = { ...clip("s", IMAGE, 0, 4 * S), keyframes: { opacity: keys([0, 0], [4 * S, 1]) } };
    const { project, rightId } = splitClip(projectWith({ clips: [still] }), "s", S);
    const right = findClip(project, rightId!)!;
    expect(right.sourceIn).toBe(0);
    expect(transformAt(right, 2 * S).opacity).toBe(0.5);
  });

  it("are the base that animations play on top of", () => {
    const a = { ...findClip(moving(), "a")!, animation: { in: { kind: "fade" as const, duration: S }, out: null, loop: null } };
    const look = animatedLook(a, 2.5 * S).transform;
    expect(look.x).toBe(0.25);
    expect(look.opacity).toBeLessThan(1);
  });
});

describe("setValuesAt", () => {
  it("changes the whole clip when the property isn't keyframed", () => {
    const project = setValuesAt(moving(), "a", 3 * S, { y: 0.2, volume: 0.5 });
    const a = findClip(project, "a")!;
    expect(a.transform.y).toBe(0.2);
    expect(a.volume).toBe(0.5);
    expect(a.keyframes!.y).toBeUndefined();
  });

  it("adds a keyframe on the playhead for keyframed properties", () => {
    const a = findClip(setValuesAt(moving(), "a", 3 * S, { x: -1 }), "a")!;
    expect(a.keyframes!.x!.map((k) => [k.time, k.value])).toEqual([
      [S, 0],
      [2 * S, -1],
      [3 * S, 1],
    ]);
    expect(a.transform.x).toBe(0);
  });

  it("updates the keyframe already on the playhead, even a hair away", () => {
    const a = findClip(setValuesAt(moving(), "a", 4 * S + 1_000, { x: 0.3 }), "a")!;
    expect(a.keyframes!.x!.map((k) => k.value)).toEqual([0, 0.3]);
  });

  it("keeps values in range", () => {
    const a = findClip(setValuesAt(moving(), "a", 3 * S, { opacity: 3, scale: -1 }), "a")!;
    expect(a.transform.opacity).toBe(1);
    expect(a.transform.scale).toBe(0.01);
  });
});

describe("toggleKeyframe", () => {
  it("adds a keyframe holding the current value", () => {
    const a = findClip(toggleKeyframe(moving(), "a", "scale", 3 * S), "a")!;
    expect(a.keyframes!.scale).toEqual(keys([2 * S, 1]));
  });

  it("removes the keyframe on the playhead", () => {
    const a = findClip(toggleKeyframe(moving(), "a", "x", 2 * S), "a")!;
    expect(a.keyframes!.x).toEqual(keys([3 * S, 1]));
  });

  it("leaves the property at the last keyframe's value", () => {
    let project = toggleKeyframe(moving(), "a", "x", 2 * S);
    project = toggleKeyframe(project, "a", "x", 4 * S);
    const a = findClip(project, "a")!;
    expect(a.keyframes).toBeUndefined();
    expect(a.transform.x).toBe(1);
  });

  it("sets the easing towards the next keyframe", () => {
    const a = findClip(setKeyframeEasing(moving(), "a", "x", 2 * S, "ease-in"), "a")!;
    expect(a.keyframes!.x![0]!.easing).toBe("ease-in");
    expect(transformAt(a, 3 * S).x).toBe(0.125);
  });
});

describe("keyframed volume", () => {
  const fading = () =>
    projectWith({ clips: [{ ...clip("v", VIDEO, 0, 2 * S), volume: 0, keyframes: { volume: keys([0, 1], [S, 0, "hold"], [1.5 * S, 1]) } }] });

  it("drives the gain, and the envelope follows it", () => {
    const v = findClip(fading(), "v")!;
    expect(clipGainAt(v, S / 2)).toBe(0.5);
    const envelope = gainEnvelope(v, 0);
    expect(envelope.find((point) => point.time === 500_000)?.gain).toBe(0.5);
    // Silent through the hold, then straight back up.
    expect(envelope.find((point) => point.time === 1.5 * S - 1)?.gain).toBe(0);
    expect(envelope.find((point) => point.time === 1.5 * S)?.gain).toBe(1);
  });

  it("counts as sound even when the clip's own volume is zero", () => {
    const project = fading();
    const v = findClip(project, "v")!;
    expect(isSilent(v)).toBe(false);
    expect(isAudible(project, v)).toBe(true);
  });

  it("goes with the sound when audio is detached", () => {
    const { project, audioClipId } = detachAudio(fading(), "v");
    expect(findClip(project, audioClipId!)!.keyframes!.volume).toHaveLength(3);
    expect(isSilent(findClip(project, "v")!)).toBe(true);
  });
});

describe("freezeFrame", () => {
  it("holds the look of the moment it freezes", () => {
    const { project, freezeId } = freezeFrame(moving(), "a", 3 * S);
    const frozen = findClip(project, freezeId!)!;
    expect(frozen.keyframes).toBeUndefined();
    expect(frozen.transform.x).toBe(0.5);
  });
});

describe("clearKeyframes", () => {
  it("keeps the values the clip has at the playhead", () => {
    const a = findClip(clearKeyframes(moving(), "a", ["x"], 3 * S), "a")!;
    expect(a.keyframes).toBeUndefined();
    expect(a.transform.x).toBe(0.5);
  });

  it("lists keyframes on the timeline once each", () => {
    const project = toggleKeyframe(moving(), "a", "opacity", 2 * S);
    expect(keyframeTimes(findClip(project, "a")!)).toEqual([2 * S, 4 * S]);
  });
});
