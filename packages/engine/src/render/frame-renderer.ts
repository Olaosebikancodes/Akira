import { VideoFrameCursor } from "../media/frame-cursor";
import type { MediaFile, MediaFiles } from "../media/media-file";
import { type Adjustments, type Clip, type Id, NEUTRAL_ADJUSTMENTS, NO_ENHANCE, type Project } from "../project/model";
import { clipAt, transitionAt } from "../project/query";
import { clipEnd, rateAt, sourceTimeAt } from "../project/timing";
import type { Micros } from "../time";
import { animatedLook, clipSeed } from "./animation";
import { parseHexColor } from "./color";
import type { BackgroundFill, Compositor, Grade, Layer, LayerProcessing, Picture, RenderItem } from "./compositor";
import { layerGeometry } from "./geometry";
import { MAX_FONT_SIZE, rasterizeText } from "./text";
import { revealedCharacters } from "./text-layout";
import { findTransition } from "./transitions";

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
  private readonly cachedLuts = new Set<Id>();
  /** Each text clip's latest drawing, kept until its words, look or size change. */
  private readonly textRasters = new Map<Id, { key: string; canvas: OffscreenCanvas; scale: number }>();

  constructor(private readonly compositor: Compositor) {}

  async render(project: Project, files: MediaFiles, time: Micros): Promise<void> {
    // Video frames are copies that must be closed once the GPU has them.
    const opened: VideoFrame[] = [];
    try {
      const items: RenderItem[] = [];
      let mainPicture: Picture | null = null;

      for (const [index, track] of project.tracks.entries()) {
        if (track.kind !== "video" || track.hidden) continue;
        const transition = transitionAt(track, time);
        const definition = transition && (await findTransition(transition.kind));
        if (transition && definition) {
          const { from, to } = transition;
          // Each side holds its edge frame while the other is on screen.
          const fromLayer = await this.layerFor(from, files, Math.min(time, clipEnd(from) - 1), opened);
          const toLayer = await this.layerFor(to, files, Math.max(time, to.start), opened);
          if (index === 0) mainPicture = (time < to.start ? fromLayer : toLayer)?.picture ?? null;
          if (fromLayer && toLayer) items.push({ kind: "transition", from: fromLayer, to: toLayer, definition, progress: transition.progress });
          else if (fromLayer ?? toLayer) items.push((fromLayer ?? toLayer)!);
          continue;
        }

        const clip = clipAt(track, time);
        if (!clip) continue;
        const layer = await this.layerFor(clip, files, time, opened);
        if (!layer) continue;
        if (index === 0) mainPicture = layer.picture;
        items.push(layer);
      }

      const background = await this.backgroundFor(project, files, mainPicture);
      this.compositor.render(background, items);
    } finally {
      for (const frame of opened) frame.close();
    }
  }

  /** Releases decoders and textures for clips, images and LUTs that are no longer in the project. */
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
    for (const assetId of this.cachedLuts) {
      if (project.assets[assetId]) continue;
      this.cachedLuts.delete(assetId);
      this.compositor.release(lutKey(assetId));
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

  private async layerFor(clip: Clip, files: MediaFiles, time: Micros, opened: VideoFrame[]): Promise<Layer | null> {
    const look = animatedLook(clip, time);
    let picture: Picture | null = null;
    if (clip.text) {
      picture = await this.textPicture(clip, look.reveal);
    } else {
      const file = files.get(clip.assetId);
      picture = file ? await this.pictureFor(clip, file, time, opened) : null;
    }
    if (!picture) return null;

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
    return {
      picture,
      model: geometry.model,
      texture: geometry.texture,
      crop: clip.crop,
      opacity: look.transform.opacity,
      processing: this.processingFor(clip, files, time),
      mask: clip.mask ?? null,
      blend: clip.blend ?? "normal",
    };
  }

  /** What to do to a clip's pixels, or null when it's shown untouched. */
  private processingFor(clip: Clip, files: MediaFiles, time: Micros): LayerProcessing | null {
    const enhance = clip.enhance ?? NO_ENHANCE;
    const lutFile = clip.lut && files.get(clip.lut.assetId);
    let lut: Grade["lut"] = null;
    if (clip.lut && lutFile?.lut && clip.lut.intensity > 0) {
      this.cachedLuts.add(clip.lut.assetId);
      lut = { cacheKey: lutKey(clip.lut.assetId), lut: lutFile.lut, intensity: clip.lut.intensity };
    }
    const key = clip.chromaKey && { ...clip.chromaKey, color: parseHexColor(clip.chromaKey.color) };
    const adjusted = clip.adjust && !isNeutral(clip.adjust);
    const grade: Grade | null =
      adjusted || lut || key || enhance.autoColor
        ? {
            black: enhance.autoColor?.black ?? [0, 0, 0],
            white: enhance.autoColor?.white ?? [1, 1, 1],
            adjust: clip.adjust ?? NEUTRAL_ADJUSTMENTS,
            lut,
            key: key ?? null,
          }
        : null;
    const effects: LayerProcessing["effects"] = (clip.effects ?? []).flatMap((effect) =>
      effect.kind !== "shake" && effect.amount > 0 ? [{ kind: effect.kind, amount: effect.amount }] : [],
    );

    const cleanup = enhance.denoise > 0 || enhance.deband > 0 || enhance.deblock > 0;
    if (!grade && effects.length === 0 && !cleanup && enhance.sharpen <= 0 && !enhance.upscale) return null;
    return {
      denoise: enhance.denoise,
      deband: enhance.deband,
      deblock: enhance.deblock,
      grade,
      effects,
      sharpen: enhance.sharpen,
      upscale: enhance.upscale,
      time: (time - clip.start) / 1_000_000,
      seed: clipSeed(clip.id),
    };
  }

  private async pictureFor(clip: Clip, file: MediaFile, time: Micros, opened: VideoFrame[]): Promise<Picture | null> {
    if (file.image) return this.imagePicture(clip.assetId, file, time - clip.start);
    if (!file.video) return null;

    const sourceTime = clip.freezeAt ?? sourceTimeAt(clip, time);
    const cursor = this.cursorFor(clip, file.video);
    const sample = await cursor.frameAt(sourceTime);
    if (!sample) return null;
    const frame = sample.toVideoFrame();
    opened.push(frame);
    const picture: Picture = {
      source: frame,
      displayWidth: sample.displayWidth,
      displayHeight: sample.displayHeight,
      rotation: sample.rotation,
      flip: sample.flip,
    };

    // In slow motion each frame would show several times; blending moves smoothly between them instead.
    const next = cursor.next;
    if (clip.frameBlending && clip.freezeAt === undefined && next && rateAt(clip, time) < 1) {
      const gap = next.microsecondTimestamp - sample.microsecondTimestamp;
      const amount = gap > 0 ? (sourceTime - sample.microsecondTimestamp) / gap : 0;
      if (amount > 0.01) {
        const nextFrame = next.toVideoFrame();
        opened.push(nextFrame);
        picture.next = { source: nextFrame, amount: Math.min(1, amount) };
      }
    }
    return picture;
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

function isNeutral(adjust: Adjustments): boolean {
  return Object.values(adjust).every((value) => value === 0);
}

function imageKey(assetId: Id): string {
  return `image:${assetId}`;
}

function lutKey(assetId: Id): string {
  return `lut:${assetId}`;
}
