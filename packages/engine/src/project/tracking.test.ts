import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../jobs/analyze";
import { layerGeometry } from "../render/geometry";
import { transformPoint } from "../render/orientation";
import { clip, IMAGE, projectWith, VIDEO } from "./fixtures.test-util";
import { propertyAt } from "./keyframes";
import { findClip } from "./query";
import { applyTracking, canvasToPicture, thin } from "./tracking";

const S = 1_000_000;

describe("thin", () => {
  it("keeps only the ends of a straight run", () => {
    const line = Array.from({ length: 30 }, (_, i) => ({ time: i * 1000, value: i * 0.01 }));
    expect(thin(line, 0.001)).toEqual([line[0], line[29]]);
  });

  it("keeps the corner of a bend", () => {
    const bend = Array.from({ length: 21 }, (_, i) => ({ time: i, value: i <= 10 ? i : 20 - i }));
    expect(thin(bend, 0.1).map((p) => p.time)).toEqual([0, 10, 20]);
  });
});

describe("applyTracking", () => {
  /** A full-frame video on the main track, and an image above it to follow something in the video. */
  function scene() {
    const video = clip("video", VIDEO, 0, 4 * S);
    const sticker = { ...clip("sticker", IMAGE, 0, 4 * S), transform: { ...clip("s", IMAGE, 0).transform, x: 0.1, scale: 0.3 } };
    return projectWith({ clips: [video] }, { clips: [sticker] });
  }

  /** Something moving from the centre to three-quarters across over the first second, shrinking to half. */
  const moving: TrackPoint[] = Array.from({ length: 31 }, (_, i) => ({
    time: Math.round((i * S) / 30),
    x: 0.5 + (0.25 * i) / 30,
    y: 0.5,
    scale: 1 - (0.5 * i) / 30,
    found: true,
  }));

  it("moves the follower with the tracked spot, keeping its offset", () => {
    const sticker = findClip(applyTracking(scene(), "sticker", "video", moving, { followScale: false }), "sticker")!;
    expect(propertyAt(sticker, "x", 0)).toBeCloseTo(0.1, 6);
    expect(propertyAt(sticker, "x", S)).toBeCloseTo(0.35, 6);
    expect(propertyAt(sticker, "x", 0.5 * S)).toBeCloseTo(0.225, 3);
    // A straight path thins down to its ends.
    expect(sticker.keyframes!.x).toHaveLength(2);
    expect(sticker.keyframes!.scale).toBeUndefined();
  });

  it("can follow its size too", () => {
    const sticker = findClip(applyTracking(scene(), "sticker", "video", moving, { followScale: true }), "sticker")!;
    expect(propertyAt(sticker, "scale", S)).toBeCloseTo(0.15, 6);
  });

  it("leaves keyframes outside the tracked span alone", () => {
    let project = scene();
    const sticker = findClip(project, "sticker")!;
    project = {
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((c) => (c.id === "sticker" ? { ...sticker, keyframes: { x: [{ time: 3 * S, value: -0.4, easing: "linear" as const }] } } : c)),
      })),
    };
    const tracked = findClip(applyTracking(project, "sticker", "video", moving, { followScale: false }), "sticker")!;
    expect(tracked.keyframes!.x!.map((k) => k.time)).toEqual([0, S, 3 * S]);
  });
});

describe("canvasToPicture", () => {
  it("undoes placing a picture point on the canvas", () => {
    const crop = { left: 0.1, top: 0, right: 0.2, bottom: 0.05 };
    const { model } = layerGeometry({
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0,
      flip: false,
      transform: { x: 0.1, y: -0.05, scale: 0.6, rotation: 20, opacity: 1, flipX: false, flipY: false },
      crop,
      canvasWidth: 1080,
      canvasHeight: 1920,
    });
    const [x, y] = transformPoint(model, (0.4 - 0.1) / 0.7, (0.3 - 0) / 0.95);
    const [px, py] = canvasToPicture(model, crop, x, y);
    expect(px).toBeCloseTo(0.4, 9);
    expect(py).toBeCloseTo(0.3, 9);
  });
});
