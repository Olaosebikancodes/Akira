import { describe, expect, it } from "vitest";
import { reverseClip, unreverseClip } from "./edit";
import { clip, projectWith, VIDEO } from "./fixtures.test-util";
import { propertyAt } from "./keyframes";
import type { Asset, Clip, Project } from "./model";
import { findClip, isReversed, reversedCopyFor } from "./query";
import { toSourceTime } from "./timing";

const S = 1_000_000;

/** A reversed copy of the video from 1 s to 5 s. */
const REVERSED: Asset = {
  ...VIDEO,
  id: "reversed",
  name: "video (reversed).mp4",
  start: 0,
  duration: 4 * S,
  reverseOf: { assetId: "video", start: S, end: 5 * S },
};

/** Footage 2 s to 5 s, with x easing in from 0 to 1 between 2 s and 4 s of footage. */
function forwards(): Project {
  const a: Clip = {
    ...clip("a", VIDEO, 0, 3 * S, 2 * S),
    keyframes: {
      x: [
        { time: 2 * S, value: 0, easing: "ease-in" },
        { time: 4 * S, value: 1, easing: "linear" },
      ],
    },
  };
  const project = projectWith({ clips: [a] });
  return { ...project, assets: { ...project.assets, reversed: REVERSED } };
}

describe("reverseClip", () => {
  it("plays the same footage from the other end", () => {
    const project = reverseClip(forwards(), "a", "reversed");
    const a = findClip(project, "a")!;
    expect(a.assetId).toBe("reversed");
    expect([a.sourceIn, a.sourceOut]).toEqual([0, 3 * S]);
    expect(isReversed(project, a)).toBe(true);
    // The first frame shown is footage 5 s, the last moment of the forwards clip.
    expect(REVERSED.reverseOf!.end - toSourceTime(a, 0)).toBe(5 * S);
  });

  it("keeps keyframes on the same moments of footage, easing the other way", () => {
    const before = findClip(forwards(), "a")!;
    const after = findClip(reverseClip(forwards(), "a", "reversed"), "a")!;
    // Timeline 2 s reversed shows footage 3 s, which forwards plays at timeline 1 s.
    expect(propertyAt(after, "x", 2 * S)).toBeCloseTo(propertyAt(before, "x", S), 10);
    expect(propertyAt(after, "x", 0)).toBe(1);
    expect(after.keyframes!.x!.map((k) => k.easing)).toEqual(["ease-out", "linear"]);
  });

  it("goes back to exactly where it was", () => {
    const project = forwards();
    const back = unreverseClip(reverseClip(project, "a", "reversed"), "a");
    expect(findClip(back, "a")).toEqual(findClip(project, "a"));
  });

  it("needs a copy that covers the whole clip", () => {
    const project = forwards();
    const short = { ...project, assets: { ...project.assets, reversed: { ...REVERSED, reverseOf: { assetId: "video", start: 3 * S, end: 5 * S } } } };
    expect(reverseClip(short, "a", "reversed")).toBe(short);
  });

  it("finds a copy made earlier", () => {
    const project = forwards();
    expect(reversedCopyFor(project, findClip(project, "a")!)?.id).toBe("reversed");
    const wider = { ...findClip(project, "a")!, sourceIn: 0 };
    expect(reversedCopyFor(project, wider)).toBeUndefined();
  });
});
