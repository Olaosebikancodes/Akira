import { describe, expect, it } from "vitest";
import {
  addMarker,
  deleteClips,
  detachAudio,
  duplicateClips,
  flipClip,
  freezeFrame,
  insertClip,
  moveClip,
  normalize,
  nudgeClip,
  removeMarker,
  replaceClipAsset,
  rotateClip90,
  setClipSpeed,
  splitClip,
  trimClip,
  updateClipLook,
} from "./edit";
import { AUDIO, clip, IMAGE, layout, projectWith, VIDEO } from "./fixtures.test-util";
import { findClip } from "./query";
import { clipDuration } from "./timing";

const S = 1_000_000;
/** One frame at the fixtures' 30 fps. */
const FRAME = 33_333;

describe("normalize", () => {
  it("packs the main track from zero in its current order", () => {
    const project = normalize(
      projectWith({ clips: [clip("a", VIDEO, 5 * S, 2 * S), clip("b", VIDEO, 1 * S, 3 * S)] }),
    );
    expect(layout(project, 0)).toEqual([
      ["a", 0, 2 * S],
      ["b", 2 * S, 5 * S],
    ]);
  });

  it("sorts other tracks and drops empty ones, but never the main track", () => {
    const project = normalize(
      projectWith(
        { clips: [] },
        { clips: [] },
        { clips: [clip("y", IMAGE, 4 * S, S), clip("x", IMAGE, 1 * S, S)] },
      ),
    );
    expect(project.tracks).toHaveLength(2);
    expect(layout(project, 1).map(([id]) => id)).toEqual(["x", "y"]);
  });
});

describe("insertClip", () => {
  const base = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S), clip("b", VIDEO, 4 * S, 4 * S)] });

  it("drops onto the main track at the nearest gap between clips", () => {
    const early = insertClip(base, clip("n", IMAGE, 0, S), { trackId: "main", time: 1 * S });
    expect(layout(early, 0).map(([id]) => id)).toEqual(["n", "a", "b"]);

    const late = insertClip(base, clip("n", IMAGE, 0, S), { trackId: "main", time: 3 * S });
    expect(layout(late, 0)).toEqual([
      ["a", 0, 4 * S],
      ["n", 4 * S, 5 * S],
      ["b", 5 * S, 9 * S],
    ]);
  });

  it("places on an overlay track when there's room, otherwise on a new track above", () => {
    const withOverlay = projectWith({ clips: [] }, { clips: [clip("o", IMAGE, 0, 2 * S)] });
    const fits = insertClip(withOverlay, clip("n", IMAGE, 0, S), { trackId: "track1", time: 3 * S });
    expect(layout(fits, 1)).toEqual([
      ["o", 0, 2 * S],
      ["n", 3 * S, 4 * S],
    ]);

    const clash = insertClip(withOverlay, clip("n", IMAGE, 0, S), { trackId: "track1", time: 1 * S });
    expect(clash.tracks).toHaveLength(3);
    expect(layout(clash, 2)).toEqual([["n", 1 * S, 2 * S]]);
  });

  it("puts audio on an audio track even when dropped on a video track", () => {
    const project = insertClip(base, clip("s", AUDIO, 0, 2 * S), { trackId: "main", time: 1 * S });
    expect(project.tracks[1]?.kind).toBe("audio");
    expect(layout(project, 1)).toEqual([["s", 1 * S, 3 * S]]);
    expect(layout(project, 0)).toEqual(layout(base, 0));
  });

  it("never starts a clip before zero", () => {
    const project = insertClip(projectWith({ clips: [] }), clip("n", IMAGE, 0, S), { time: -5 * S });
    expect(layout(project, 1)).toEqual([["n", 0, S]]);
  });
});

describe("moveClip", () => {
  it("reorders the main track", () => {
    const project = projectWith({
      clips: [clip("a", VIDEO, 0, 2 * S), clip("b", VIDEO, 2 * S, 2 * S), clip("c", VIDEO, 4 * S, 2 * S)],
    });
    const moved = moveClip(project, "a", { trackId: "main", time: 5.5 * S });
    expect(layout(moved, 0).map(([id]) => id)).toEqual(["b", "c", "a"]);
  });

  it("lifts a clip off the main track onto an overlay, closing the gap", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 2 * S), clip("b", VIDEO, 2 * S, 2 * S)] });
    const moved = moveClip(project, "a", { time: 3 * S });
    expect(layout(moved, 0)).toEqual([["b", 0, 2 * S]]);
    expect(layout(moved, 1)).toEqual([["a", 3 * S, 5 * S]]);
  });

  it("moves along its own overlay track without colliding with itself", () => {
    const project = projectWith({ clips: [] }, { clips: [clip("o", IMAGE, 0, 2 * S)] });
    const moved = moveClip(project, "o", { trackId: "track1", time: 1 * S });
    expect(moved.tracks).toHaveLength(2);
    expect(layout(moved, 1)).toEqual([["o", 1 * S, 3 * S]]);
  });

  it("leaves locked tracks alone", () => {
    const project = projectWith({ clips: [] }, { clips: [clip("o", IMAGE, 0, 2 * S)], locked: true });
    expect(moveClip(project, "o", { trackId: "track1", time: 5 * S })).toBe(project);
  });
});

describe("trimClip", () => {
  it("ripples the main track when a clip gets shorter or longer", () => {
    const project = projectWith({
      clips: [clip("a", VIDEO, 0, 4 * S, 2 * S), clip("b", VIDEO, 4 * S, 2 * S)],
    });
    const shorter = trimClip(project, "a", "end", 3 * S);
    expect(layout(shorter, 0)).toEqual([
      ["a", 0, 3 * S],
      ["b", 3 * S, 5 * S],
    ]);

    const fromLeft = trimClip(project, "a", "start", 1 * S);
    expect(layout(fromLeft, 0)[0]).toEqual(["a", 0, 3 * S]);
    expect(findClip(fromLeft, "a")?.sourceIn).toBe(3 * S);
  });

  it("can't reach past the source", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S, 2 * S)] });
    expect(findClip(trimClip(project, "a", "start", -10 * S), "a")?.sourceIn).toBe(0);
    expect(findClip(trimClip(project, "a", "end", 60 * S), "a")?.sourceOut).toBe(10 * S);
  });

  it("stops at neighbours on an overlay track", () => {
    const project = projectWith(
      { clips: [] },
      { clips: [clip("x", VIDEO, 0, 2 * S), clip("y", VIDEO, 3 * S, 2 * S, 4 * S), clip("z", VIDEO, 6 * S, 2 * S)] },
    );
    expect(layout(trimClip(project, "y", "start", 0), 1)[1]).toEqual(["y", 2 * S, 5 * S]);
    expect(layout(trimClip(project, "y", "end", 9 * S), 1)[1]).toEqual(["y", 3 * S, 6 * S]);
  });

  it("never goes below one frame", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S)] });
    expect(clipDuration(findClip(trimClip(project, "a", "end", 0), "a")!)).toBe(FRAME);
  });

  it("lets stills grow to any length", () => {
    const project = projectWith({ clips: [clip("i", IMAGE, 0, 5 * S)] });
    expect(layout(trimClip(project, "i", "end", 60 * S), 0)).toEqual([["i", 0, 60 * S]]);
  });
});

describe("splitClip", () => {
  it("cuts a clip into two continuous halves", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 6 * S, 1 * S)] });
    const { project: split, rightId } = splitClip(project, "a", 2 * S);
    const [left, right] = split.tracks[0]!.clips;
    expect(left).toMatchObject({ id: "a", start: 0, sourceIn: 1 * S, sourceOut: 3 * S });
    expect(right).toMatchObject({ id: rightId, start: 2 * S, sourceIn: 3 * S, sourceOut: 7 * S });
  });

  it("refuses to leave a piece shorter than a frame", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 6 * S)] });
    expect(splitClip(project, "a", 10_000).rightId).toBeNull();
    expect(splitClip(project, "a", 6 * S - 10_000).rightId).toBeNull();
  });

  it("splits stills by length", () => {
    const project = projectWith({ clips: [clip("i", IMAGE, 0, 5 * S)] });
    const { project: split } = splitClip(project, "i", 2 * S);
    expect(layout(split, 0).map(([, start, end]) => [start, end])).toEqual([
      [0, 2 * S],
      [2 * S, 5 * S],
    ]);
  });
});

describe("deleteClips", () => {
  const project = projectWith(
    { clips: [clip("a", VIDEO, 0, 2 * S), clip("b", VIDEO, 2 * S, 2 * S), clip("c", VIDEO, 4 * S, 2 * S)] },
    { clips: [clip("x", IMAGE, 0, 2 * S), clip("y", IMAGE, 3 * S, 2 * S)] },
  );

  it("closes the gap on the main track", () => {
    expect(layout(deleteClips(project, ["b"]), 0)).toEqual([
      ["a", 0, 2 * S],
      ["c", 2 * S, 4 * S],
    ]);
  });

  it("leaves a gap elsewhere unless rippling", () => {
    expect(layout(deleteClips(project, ["x"]), 1)).toEqual([["y", 3 * S, 5 * S]]);
    expect(layout(deleteClips(project, ["x"], true), 1)).toEqual([["y", 1 * S, 3 * S]]);
  });

  it("removes a track once it's empty", () => {
    expect(deleteClips(project, ["x", "y"]).tracks).toHaveLength(1);
  });
});

describe("duplicateClips", () => {
  it("puts the copy right after the original", () => {
    const project = projectWith(
      { clips: [clip("a", VIDEO, 0, 2 * S), clip("b", VIDEO, 2 * S, 2 * S)] },
      { clips: [clip("x", IMAGE, 0, 2 * S)] },
    );
    const { project: copied, newIds } = duplicateClips(project, ["a", "x"]);
    expect(newIds).toHaveLength(2);
    expect(layout(copied, 0).map(([id]) => id)).toEqual(["a", newIds[0], "b"]);
    expect(layout(copied, 1)).toEqual([
      ["x", 0, 2 * S],
      [newIds[1]!, 2 * S, 4 * S],
    ]);
  });
});

describe("replaceClipAsset", () => {
  it("keeps the clip's place and length", () => {
    const project = projectWith({ clips: [clip("i", IMAGE, 0, 3 * S), clip("b", VIDEO, 3 * S, 2 * S)] });
    const replaced = replaceClipAsset(project, "i", VIDEO);
    expect(findClip(replaced, "i")).toMatchObject({ assetId: "video", sourceIn: 0, sourceOut: 3 * S });
    expect(layout(replaced, 0)).toEqual(layout(project, 0));
  });

  it("gets shorter when the new media is shorter", () => {
    const project = projectWith({ clips: [clip("i", IMAGE, 0, 30 * S)] });
    expect(layout(replaceClipAsset(project, "i", VIDEO), 0)).toEqual([["i", 0, 10 * S]]);
  });

  it("won't put audio on a video track", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 3 * S)] });
    expect(replaceClipAsset(project, "a", AUDIO)).toBe(project);
  });
});

describe("freezeFrame", () => {
  it("holds a frame mid-clip and pushes the rest of the main track later", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 6 * S), clip("b", VIDEO, 6 * S, 2 * S)] });
    const { project: frozen, freezeId } = freezeFrame(project, "a", 2 * S);
    const ids = layout(frozen, 0).map(([id]) => id);
    expect(ids).toHaveLength(4);
    expect(layout(frozen, 0)[1]).toEqual([freezeId, 2 * S, 5 * S]);
    expect(layout(frozen, 0)[3]).toEqual(["b", 9 * S, 11 * S]);
    expect(findClip(frozen, freezeId!)).toMatchObject({ freezeAt: 2 * S, volume: 0 });
  });

  it("makes room on an overlay track", () => {
    const project = projectWith(
      { clips: [] },
      { clips: [clip("x", VIDEO, 0, 4 * S), clip("y", IMAGE, 5 * S, S)] },
    );
    const { project: frozen, freezeId } = freezeFrame(project, "x", 4 * S - 1);
    expect(layout(frozen, 1)).toEqual([
      ["x", 0, 4 * S],
      [freezeId, 4 * S, 7 * S],
      ["y", 8 * S, 9 * S],
    ]);
  });

  it("only freezes moving video", () => {
    const project = projectWith({ clips: [clip("i", IMAGE, 0, 3 * S)] });
    expect(freezeFrame(project, "i", S).freezeId).toBeNull();
  });
});

describe("detachAudio", () => {
  it("moves the sound to an audio track and silences the video", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S, 1 * S)] });
    const { project: detached, audioClipId } = detachAudio(project, "a");
    expect(findClip(detached, "a")?.volume).toBe(0);
    expect(detached.tracks[1]?.kind).toBe("audio");
    expect(findClip(detached, audioClipId!)).toMatchObject({ start: 0, sourceIn: 1 * S, sourceOut: 5 * S, volume: 1 });
  });

  it("does nothing for stills or already silent clips", () => {
    expect(detachAudio(projectWith({ clips: [clip("i", IMAGE, 0, S)] }), "i").audioClipId).toBeNull();
    const silent = updateClipLook(projectWith({ clips: [clip("a", VIDEO, 0, S)] }), "a", { volume: 0 });
    expect(detachAudio(silent, "a").audioClipId).toBeNull();
  });
});

describe("setClipSpeed", () => {
  it("changes the clip's length and ripples the main track", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S), clip("b", VIDEO, 4 * S, 2 * S)] });
    expect(layout(setClipSpeed(project, "a", 2), 0)).toEqual([
      ["a", 0, 2 * S],
      ["b", 2 * S, 4 * S],
    ]);
  });

  it("pushes the next overlay clip along when the clip grows into it", () => {
    const project = projectWith(
      { clips: [] },
      { clips: [clip("x", VIDEO, 0, 2 * S), clip("y", IMAGE, 3 * S, S)] },
    );
    expect(layout(setClipSpeed(project, "x", 0.5), 1)).toEqual([
      ["x", 0, 4 * S],
      ["y", 4 * S, 5 * S],
    ]);
  });

  it("clamps to 0.25x-4x and ignores stills", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S), clip("i", IMAGE, 4 * S, S)] });
    expect(findClip(setClipSpeed(project, "a", 100), "a")?.speed).toBe(4);
    expect(setClipSpeed(project, "i", 2)).toBe(project);
  });
});

describe("look", () => {
  const project = projectWith({ clips: [clip("a", VIDEO, 0, S)] });

  it("rotates in quarter turns and keeps the angle readable", () => {
    let turned = project;
    for (let i = 0; i < 3; i++) turned = rotateClip90(turned, "a");
    expect(findClip(turned, "a")?.transform.rotation).toBe(-90);
  });

  it("flips each axis independently", () => {
    const flipped = flipClip(flipClip(project, "a", "x"), "a", "y");
    expect(findClip(flipped, "a")?.transform).toMatchObject({ flipX: true, flipY: true });
  });

  it("keeps at least 5% of the picture when cropping", () => {
    const cropped = updateClipLook(project, "a", { crop: { left: 0.6, right: 0.6 } });
    const crop = findClip(cropped, "a")!.crop;
    expect(crop.left).toBe(0.6);
    expect(crop.right).toBeCloseTo(0.35);
  });
});

describe("nudgeClip", () => {
  it("swaps neighbours on the main track", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, S), clip("b", VIDEO, S, S)] });
    expect(layout(nudgeClip(project, "a", 1), 0).map(([id]) => id)).toEqual(["b", "a"]);
    expect(nudgeClip(project, "a", -1)).toBe(project);
  });

  it("moves by frames elsewhere, stopping at neighbours", () => {
    const project = projectWith({ clips: [] }, { clips: [clip("x", IMAGE, S, S), clip("y", IMAGE, 2 * S + 2 * FRAME, S)] });
    expect(layout(nudgeClip(project, "x", 1), 1)[0]).toEqual(["x", S + FRAME, 2 * S + FRAME]);
    expect(layout(nudgeClip(project, "x", 10), 1)[0]).toEqual(["x", S + 2 * FRAME, 2 * S + 2 * FRAME]);
  });
});

describe("markers", () => {
  it("adds markers in time order without duplicates, and removes them", () => {
    let project = projectWith({ clips: [] });
    project = addMarker(addMarker(addMarker(project, 3 * S), S), 3 * S);
    expect(project.markers.map((m) => m.time)).toEqual([S, 3 * S]);
    project = removeMarker(project, project.markers[0]!.id);
    expect(project.markers.map((m) => m.time)).toEqual([3 * S]);
  });
});
