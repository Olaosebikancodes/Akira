import { describe, expect, it } from "vitest";
import { createTextClip } from "./create";
import {
  addCaptions,
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
  setAudioFilters,
  setClipAnimation,
  setTransition,
  setClipFades,
  setClipSpeed,
  setTrackFlag,
  splitClip,
  trimClip,
  updateClipLook,
  updateText,
} from "./edit";
import { AUDIO, clip, IMAGE, layout, projectWith, VIDEO } from "./fixtures.test-util";
import { CAPTION_STYLE, DEFAULT_TEXT_STYLE } from "./model";
import { findClip, transitionAt } from "./query";
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

describe("fades", () => {
  const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S)] });

  it("keeps fades inside the clip, giving way to the fade already set", () => {
    let faded = setClipFades(project, "a", { fadeOut: 3 * S });
    faded = setClipFades(faded, "a", { fadeIn: 3 * S });
    expect(findClip(faded, "a")).toMatchObject({ fadeIn: S, fadeOut: 3 * S });
  });

  it("leaves the outer fades on the outer pieces when splitting", () => {
    const faded = setClipFades(setClipFades(project, "a", { fadeIn: S }), "a", { fadeOut: S });
    const { project: split, rightId } = splitClip(faded, "a", 2 * S);
    expect(findClip(split, "a")).toMatchObject({ fadeIn: S, fadeOut: 0 });
    expect(findClip(split, rightId!)).toMatchObject({ fadeIn: 0, fadeOut: S });
  });

  it("shrinks fades that no longer fit after a trim", () => {
    const faded = setClipFades(setClipFades(project, "a", { fadeIn: 2 * S }), "a", { fadeOut: 2 * S });
    const trimmed = trimClip(faded, "a", "end", 2 * S);
    expect(findClip(trimmed, "a")).toMatchObject({ fadeIn: S, fadeOut: S });
  });
});

describe("audio filters and solo", () => {
  it("clamps hiss reduction to 0-1 and keeps other filters", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, S)] });
    const filtered = setAudioFilters(setAudioFilters(project, "a", { hum: 50 }), "a", { denoise: 3 });
    expect(findClip(filtered, "a")?.audioFilters).toEqual({ denoise: 1, hum: 50, rumble: false });
  });

  it("solos a track", () => {
    const project = projectWith({ clips: [] }, { kind: "audio", clips: [] });
    expect(setTrackFlag(project, "track1", "solo", true).tracks[1]?.solo).toBe(true);
  });
});

describe("text", () => {
  const titled = () => {
    const title = { ...createTextClip(0, { content: "Hello", style: DEFAULT_TEXT_STYLE }), id: "t" };
    return projectWith({ clips: [clip("a", VIDEO, 0, 4 * S)] }, { clips: [title] });
  };

  it("changes the words and merges style changes", () => {
    const edited = updateText(titled(), "t", { content: "Hi\nthere", style: { color: "#ff0000", size: 2 } });
    expect(findClip(edited, "t")?.text).toEqual({
      content: "Hi\nthere",
      style: { ...DEFAULT_TEXT_STYLE, color: "#ff0000", size: 0.5 },
    });
  });

  it("leaves clips that aren't text alone", () => {
    const project = titled();
    expect(updateText(project, "a", { content: "Nope" })).toBe(project);
  });

  it("drops the text when a text clip is replaced with media", () => {
    expect(findClip(replaceClipAsset(titled(), "t", IMAGE), "t")?.text).toBeUndefined();
  });

  it("splits text into two clips saying the same thing", () => {
    const { project, rightId } = splitClip(titled(), "t", S);
    expect(findClip(project, rightId!)?.text?.content).toBe("Hello");
  });
});

describe("animations", () => {
  it("sets in, out and loop animations independently", () => {
    let project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S)] });
    project = setClipAnimation(project, "a", { in: { kind: "fade", duration: S } });
    project = setClipAnimation(project, "a", { loop: { kind: "pulse", period: S } });
    expect(findClip(project, "a")?.animation).toEqual({
      in: { kind: "fade", duration: S },
      out: null,
      loop: { kind: "pulse", period: S },
    });
  });

  it("shrinks in and out animations to fit a shorter clip", () => {
    let project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S)] });
    project = setClipAnimation(project, "a", { in: { kind: "fade", duration: 2 * S }, out: { kind: "fade", duration: 2 * S } });
    project = trimClip(project, "a", "end", 2 * S);
    expect(findClip(project, "a")?.animation).toMatchObject({ in: { duration: S }, out: { duration: S } });
  });
});

describe("addCaptions", () => {
  it("puts one caption clip per cue on a new track, overlaps on another", () => {
    const project = projectWith({ clips: [clip("a", VIDEO, 0, 4 * S)] });
    const { project: captioned, clipIds } = addCaptions(project, [
      { start: S, end: 2 * S, text: "One" },
      { start: 3 * S, end: 4 * S, text: "Two" },
      { start: 3.5 * S, end: 5 * S, text: "Overlap" },
    ]);
    expect(clipIds).toHaveLength(3);
    expect(captioned.tracks).toHaveLength(3);
    expect(layout(captioned, 1)).toEqual([
      [clipIds[0], S, 2 * S],
      [clipIds[1], 3 * S, 4 * S],
    ]);
    const first = findClip(captioned, clipIds[0]!)!;
    expect(first.text).toEqual({ content: "One", style: CAPTION_STYLE });
    expect(first.transform.y).toBeGreaterThan(0.3);
  });
});

describe("grading and effects", () => {
  const project = projectWith({ clips: [clip("a", VIDEO, 0, 2 * S)] });

  it("merges adjustments onto neutral and keeps them in range", () => {
    const graded = updateClipLook(project, "a", { adjust: { contrast: 0.4, vignette: -1, saturation: 3 } });
    expect(findClip(graded, "a")?.adjust).toMatchObject({ contrast: 0.4, vignette: 0, saturation: 1, brightness: 0 });
  });

  it("adds and removes a mask and a chroma key", () => {
    let edited = updateClipLook(project, "a", { mask: { shape: "heart", feather: 2 }, chromaKey: { tolerance: 0.5 } });
    expect(findClip(edited, "a")?.mask).toMatchObject({ shape: "heart", feather: 1, width: 0.6 });
    expect(findClip(edited, "a")?.chromaKey).toMatchObject({ color: "#00ff00", tolerance: 0.5 });
    edited = updateClipLook(edited, "a", { mask: null, chromaKey: null });
    expect(findClip(edited, "a")?.mask).toBeUndefined();
    expect(findClip(edited, "a")?.chromaKey).toBeUndefined();
  });

  it("keeps effect amounts and enhance settings in range", () => {
    const edited = updateClipLook(project, "a", {
      effects: [{ kind: "glitch", amount: 5 }],
      enhance: { sharpen: 2, upscale: true },
    });
    expect(findClip(edited, "a")?.effects).toEqual([{ kind: "glitch", amount: 1 }]);
    expect(findClip(edited, "a")?.enhance).toMatchObject({ sharpen: 1, upscale: true, denoise: 0 });
  });
});

describe("transitions", () => {
  const twoClips = () => projectWith({ clips: [clip("a", VIDEO, 0, 2 * S), clip("b", VIDEO, 2 * S, S)] });

  it("joins a clip to the next one, no longer than the shorter clip", () => {
    const joined = setTransition(twoClips(), "a", { kind: "Fade", duration: 5 * S });
    expect(findClip(joined, "a")?.transition).toEqual({ kind: "Fade", duration: S });
  });

  it("needs a clip right after", () => {
    const project = twoClips();
    expect(setTransition(project, "b", { kind: "Fade", duration: S })).toBe(project);
  });

  it("is dropped when the clips stop touching", () => {
    let project = projectWith(
      { clips: [] },
      { clips: [clip("x", IMAGE, 0, 2 * S), clip("y", IMAGE, 2 * S, 2 * S)] },
    );
    project = setTransition(project, "x", { kind: "Fade", duration: S });
    expect(findClip(project, "x")?.transition).toBeDefined();
    project = moveClip(project, "y", { trackId: "track1", time: 3 * S });
    expect(findClip(project, "x")?.transition).toBeUndefined();
  });

  it("stays at the cut when the left clip is split", () => {
    const joined = setTransition(twoClips(), "a", { kind: "Fade", duration: S / 2 });
    const { project, rightId } = splitClip(joined, "a", S);
    expect(findClip(project, "a")?.transition).toBeUndefined();
    expect(findClip(project, rightId!)?.transition).toEqual({ kind: "Fade", duration: S / 2 });
  });
});

describe("transitionAt", () => {
  const joined = () =>
    setTransition(projectWith({ clips: [clip("a", VIDEO, 0, 2 * S), clip("b", VIDEO, 2 * S, 2 * S)] }), "a", {
      kind: "Fade",
      duration: S,
    });

  it("is centred on the cut", () => {
    const track = joined().tracks[0]!;
    expect(transitionAt(track, 1.4 * S)).toBeUndefined();
    expect(transitionAt(track, 1.5 * S)).toMatchObject({ kind: "Fade", progress: 0 });
    expect(transitionAt(track, 2 * S)?.progress).toBeCloseTo(0.5);
    expect(transitionAt(track, 2.4 * S)?.progress).toBeCloseTo(0.9);
    expect(transitionAt(track, 2.5 * S)).toBeUndefined();
  });

  it("names both clips", () => {
    const found = transitionAt(joined().tracks[0]!, 2 * S);
    expect(found?.from.id).toBe("a");
    expect(found?.to.id).toBe("b");
  });
});
