import { type Micros, microsToSeconds } from "../time";
import type { MediaFile } from "./media-file";

export interface Thumbnail {
  /** Source time the picture was taken from. */
  time: Micros;
  image: ImageBitmap;
}

/**
 * Small pictures for the media panel and the timeline's filmstrip: `count`
 * evenly spaced frames, each scaled to `height` pixels tall. Audio files have
 * none; still images give one.
 */
export async function createThumbnails(file: MediaFile, count: number, height: number): Promise<Thumbnail[]> {
  const { info } = file;
  if (file.image) {
    const source = await file.image.frameAt(0);
    const width = Math.round((file.image.width / file.image.height) * height);
    return [{ time: 0, image: await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: "medium" }) }];
  }
  if (!file.video || !info.video) return [];

  const width = Math.max(1, Math.round((info.video.width / info.video.height) * height));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  const times = Array.from({ length: count }, (_, i) => info.start + Math.round(((i + 0.5) * info.duration) / count));

  const thumbnails: Thumbnail[] = [];
  let index = 0;
  for await (const sample of file.video.samplesAtTimestamps(times.map(microsToSeconds))) {
    const time = times[index++]!;
    if (!sample) continue;
    // draw() applies the file's rotation, so phone footage comes out upright.
    sample.draw(context, 0, 0, width, height);
    sample.close();
    thumbnails.push({ time, image: await createImageBitmap(canvas) });
  }
  return thumbnails;
}
