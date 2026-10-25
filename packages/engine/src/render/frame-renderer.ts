import { VideoFrameCursor } from "../media/frame-cursor";
import type { MediaFile, MediaFiles } from "../media/media-file";
import type { Clip, Id, Project } from "../project/model";
import { clipAt } from "../project/query";
import { sourceTimeAt } from "../project/timing";
import type { Micros } from "../time";
import { animatedLook } from "./animation";
import { parseHexColor } from "./color";
import type { BackgroundFill, Compositor, Layer, Picture } from "./compositor";
import { layerGeometry } from "./geometry";
import { MAX_FONT_SIZE, rasterizeText } from "./text";
import { revealedCharacters } from "./text-layout";

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
  /** Each text clip's latest drawing, kept until its words, look or size change. */
  private readonly textRasters = new Map<Id, { key: string; canvas: OffscreenCanvas; scale: number }>();

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
        if (!clip) continue;
        const look = animatedLook(clip, time);

        let picture: Picture | null = null;
        if (clip.text) {
          picture = await this.textPicture(clip, look.reveal);
        } else {
          const file = files.get(clip.assetId);
          picture = file ? await this.pictureFor(clip, file, time, opened) : null;
        }
        if (!picture) continue;
        if (index === 0) mainPicture = picture;
        const geometry = layerGeometry({
          displayWidth: picture.displayWidth,
          displayHeight: picture.displayHeight,
          rotation: picture.rotation,
          flip: picture.flip,
          transform: look.transform,
          crop: clip.crop,
          canvasWidth: this.compositor.width,
          canvasHeight: this.compositor.height,
          fit: clip.text ? "natural" : "contain",
        });
        layers.push({ picture, model: geometry.model, texture: geometry.texture, opacity: look.transform.opacity });
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
    for (const [clipId, raster] of this.textRasters) {
      if (live.has(clipId)) continue;
      this.textRasters.delete(clipId);
      this.compositor.release(raster.key);
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

  /**
   * Draws text at the size it appears on screen, so scaled-up text stays
   * sharp. Animations scale the finished drawing instead, so a "pop" doesn't
   * redraw the text every frame.
   */
  private async textPicture(clip: Clip, reveal: number): Promise<Picture> {
    const text = clip.text!;
    const shortEdge = Math.min(this.compositor.width, this.compositor.height);
    const baseSize = text.style.size * shortEdge;
    const scale = Math.min(Math.max(clip.transform.scale, 0.05), MAX_FONT_SIZE / baseSize);
    const shown = revealedCharacters(text.content, reveal);
    const key = `text:${clip.id}:${(baseSize * scale).toFixed(1)}:${shown}:${JSON.stringify(text)}`;

    let raster = this.textRasters.get(clip.id);
    if (raster?.key !== key) {
      if (raster) this.compositor.release(raster.key);
      raster = { key, canvas: await rasterizeText(text, baseSize * scale, reveal), scale };
      this.textRasters.set(clip.id, raster);
    }
    return {
      source: raster.canvas,
      displayWidth: raster.canvas.width / raster.scale,
      displayHeight: raster.canvas.height / raster.scale,
      rotation: 0,
      flip: false,
      cacheKey: raster.key,
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
