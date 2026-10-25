import type { AudioBufferSink } from "mediabunny";
import { describe, expect, it } from "vitest";
import type { MediaFile } from "../media/media-file";
import { setTrackFlag } from "../project/edit";
import { AUDIO, clip, projectWith, VIDEO } from "../project/fixtures.test-util";
import { audibleClips } from "./schedule";

// audibleClips only needs to know which assets have decodable audio.
const files = new Map<string, MediaFile>([
  ["video", { audio: {} as AudioBufferSink } as MediaFile],
  ["audio", { audio: {} as AudioBufferSink } as MediaFile],
]);

describe("audibleClips", () => {
  const project = projectWith(
    { clips: [clip("v", VIDEO, 0, 1_000_000)] },
    { kind: "audio", clips: [clip("music", AUDIO, 0, 1_000_000)] },
  );
  const ids = (p: typeof project) => audibleClips(p, files).map(({ clip }) => clip.id);

  it("plays every clip with sound by default", () => {
    expect(ids(project)).toEqual(["v", "music"]);
  });

  it("skips muted tracks", () => {
    expect(ids(setTrackFlag(project, "track1", "muted", true))).toEqual(["v"]);
  });

  it("plays only soloed tracks while any is soloed", () => {
    expect(ids(setTrackFlag(project, "track1", "solo", true))).toEqual(["music"]);
  });
});
