import { VideoFrameCursor } from "../media/frame-cursor";
import type { MediaFile, MediaFiles } from "../media/media-file";
import type { Clip, Id, Project } from "../project/model";
import { clipAt } from "../project/query";
import { sourceTimeAt } from "../project/timing";
import type { Micros } from "../time";
import { parseHexColor } from "./color";
import type { BackgroundFill, Compositor, Layer, Picture } from "./compositor";
import { layerGeometry } from "./geometry";

const BLACK: BackgroundFill = { kind: "color", color: [0, 0, 0] };

/**
 * Draws the project as it looks at a given time. Preview and export share
 * this, so both pick the same source frames and composite them the same way.
 *
 * Each clip gets its own frame cursor, so two clips cut from the same file
 * don't fight over one decoder. Calls to `render` must not overlap.
 */
export class FrameRenderer {
  private readonly cursors = new Map<Id, VideoFrameCursor>();
  private readonly cachedImages = new Set<Id>();

  constructor(private readonly compositor: Compositor) {}

  async render(project: Project, files: MediaFiles, time: Micros): Promise<void> {
    // Video frames are copies that must be closed once the GPU has them.
    const opened: VideoFrame[] = [];
    try {
      const layers: Layer[] = [];
      let mainPicture: Picture | null = null;

      for (const [index, track] of project.tracks.entries()) {
        if (track.kind !== "video" || track.hidden) continue;
        const clip = clipAt(track, time);
        const file = clip && files.get(clip.assetId);
        if (!clip || !file) continue;

        const picture = await this.pictureFor(clip, file, time, opened);
        if (!picture) continue;
        if (index === 0) mainPicture = picture;
        const geometry = layerGeometry({
          displayWidth: picture.displayWidth,
          displayHeight: picture.displayHeight,
          rotation: picture.rotation,
          flip: picture.flip,
          transform: clip.transform,
          crop: clip.crop,
          canvasWidth: this.compositor.width,
          canvasHeight: this.compositor.height,
        });
        layers.push({ picture, model: geometry.model, texture: geometry.texture, opacity: clip.transform.opacity });
      }

      const background = await this.backgroundFor(project, files, mainPicture);
      this.compositor.render(background, layers);
    } finally {
      for (const frame of opened) frame.close();
    }
  }

  /** Releases decoders and textures for clips and images that are no longer in the project. */
  async prune(project: Project): Promise<void> {
    const live = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
    for (const [clipId, cursor] of this.cursors) {
      if (live.has(clipId)) continue;
      this.cursors.delete(clipId);
      await cursor.close();
    }
    for (const assetId of this.cachedImages) {
      if (project.assets[assetId]) continue;
      this.cachedImages.delete(assetId);
      this.compositor.release(imageKey(assetId));
    }
  }

  async close(): Promise<void> {
    const cursors = [...this.cursors.values()];
    this.cursors.clear();
    await Promise.all(cursors.map((cursor) => cursor.close()));
  }

  private async pictureFor(clip: Clip, file: MediaFile, time: Micros, opened: VideoFrame[]): Promise<Picture | null> {
    if (file.image) return this.imagePicture(clip.assetId, file, time - clip.start);
    if (!file.video) return null;

    const sourceTime = clip.freezeAt ?? sourceTimeAt(clip, time);
    const sample = await this.cursorFor(clip, file.video).frameAt(sourceTime);
    if (!sample) return null;
    const frame = sample.toVideoFrame();
    opened.push(frame);
    return {
      source: frame,
      displayWidth: sample.displayWidth,
      displayHeight: sample.displayHeight,
      rotation: sample.rotation,
      flip: sample.flip,
    };
  }

  private async imagePicture(assetId: Id, file: MediaFile, time: Micros): Promise<Picture> {
    const image = file.image!;
    this.cachedImages.add(assetId);
    return {
      source: await image.frameAt(time),
      displayWidth: image.width,
      displayHeight: image.height,
      rotation: 0,
      flip: false,
      cacheKey: imageKey(assetId),
    };
  }

  private async backgroundFor(project: Project, files: MediaFiles, main: Picture | null): Promise<BackgroundFill> {
    const background = project.canvas.background;
    switch (background.kind) {
      case "color":
        return { kind: "color", color: parseHexColor(background.color) };
      case "blur":
        return main ? { kind: "blur", picture: main, amount: background.amount } : BLACK;
      case "image": {
        const file = files.get(background.assetId);
        if (!file?.image) return BLACK;
        return { kind: "picture", picture: await this.imagePicture(background.assetId, file, 0) };
      }
    }
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

function imageKey(assetId: Id): string {
  return `image:${assetId}`;
}
