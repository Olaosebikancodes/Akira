import { VideoFrameCursor } from "../media/frame-cursor";
import type { MediaFile, MediaFiles } from "../media/media-file";
import { clipAt } from "../project/query";
import type { Clip, Id, Project } from "../project/model";
import { sourceTimeAt } from "../project/timing";
import type { Micros } from "../time";
import { parseHexColor } from "./color";
import type { Compositor, VideoLayer } from "./compositor";
import { fitContain } from "./fit";

/**
 * Draws the project as it looks at a given time. Preview and export share
 * this, so both pick the same source frames and composite them the same way.
 *
 * Each clip gets its own frame cursor, so two clips cut from the same file
 * don't fight over one decoder. Calls to `render` must not overlap.
 */
export class FrameRenderer {
  private readonly cursors = new Map<Id, VideoFrameCursor>();

  constructor(private readonly compositor: Compositor) {}

  async render(project: Project, files: MediaFiles, time: Micros): Promise<void> {
    const layers: VideoLayer[] = [];
    for (const track of project.tracks) {
      if (track.kind !== "video" || track.hidden) continue;
      const clip = clipAt(track, time);
      const sink = clip && files.get(clip.assetId)?.video;
      if (!clip || !sink) continue;

      const sample = await this.cursorFor(clip, sink).frameAt(sourceTimeAt(clip, time));
      if (!sample) continue;
      layers.push({
        sample,
        rect: fitContain(
          sample.displayWidth,
          sample.displayHeight,
          this.compositor.width,
          this.compositor.height,
        ),
      });
    }
    const { background } = project.canvas;
    this.compositor.render(background.kind === "color" ? parseHexColor(background.color) : [0, 0, 0], layers);
  }

  /** Releases decoders for clips that are no longer in the project. */
  async prune(project: Project): Promise<void> {
    const live = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
    for (const [clipId, cursor] of this.cursors) {
      if (live.has(clipId)) continue;
      this.cursors.delete(clipId);
      await cursor.close();
    }
  }

  async close(): Promise<void> {
    const cursors = [...this.cursors.values()];
    this.cursors.clear();
    await Promise.all(cursors.map((cursor) => cursor.close()));
  }

  private cursorFor(clip: Clip, sink: NonNullable<MediaFile["video"]>): VideoFrameCursor {
    let cursor = this.cursors.get(clip.id);
    if (!cursor) {
      cursor = new VideoFrameCursor(sink);
      this.cursors.set(clip.id, cursor);
    }
    return cursor;
  }
}
