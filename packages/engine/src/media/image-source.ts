import type { Micros } from "../time";

/** Image formats that may carry animation, decoded frame by frame with ImageDecoder. */
const MAYBE_ANIMATED = new Set(["image/gif", "image/webp", "image/png", "image/apng", "image/avif"]);

/**
 * A still or animated image. Stills decode once into a bitmap. Animations
 * record each frame's duration up front and decode frames on demand, so a
 * long GIF doesn't sit in memory as hundreds of full-size frames.
 */
export class ImageSource {
  private lastFrame: { index: number; frame: VideoFrame } | null = null;

  private constructor(
    readonly width: number,
    readonly height: number,
    private readonly still: ImageBitmap | null,
    private readonly decoder: ImageDecoder | null,
    /** Start time of each frame within one loop. */
    private readonly frameStarts: readonly Micros[],
    /** Length of one loop; 0 for stills. */
    readonly duration: Micros,
  ) {}

  get animated(): boolean {
    return this.decoder !== null;
  }

  static async open(file: File): Promise<ImageSource> {
    if (typeof ImageDecoder !== "undefined" && MAYBE_ANIMATED.has(file.type)) {
      const animated = await ImageSource.openAnimated(file);
      if (animated) return animated;
    }
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return new ImageSource(bitmap.width, bitmap.height, bitmap, null, [], 0);
  }

  /**
   * The picture to show `time` into the clip. Animations loop. The returned
   * image belongs to this source and stays valid until the next call.
   */
  async frameAt(time: Micros): Promise<ImageBitmap | VideoFrame> {
    if (this.still) return this.still;
    const index = this.frameIndexAt(time);
    if (this.lastFrame?.index === index) return this.lastFrame.frame;
    const { image } = await this.decoder!.decode({ frameIndex: index });
    this.lastFrame?.frame.close();
    this.lastFrame = { index, frame: image };
    return image;
  }

  dispose(): void {
    this.still?.close();
    this.lastFrame?.frame.close();
    this.decoder?.close();
  }

  private frameIndexAt(time: Micros): number {
    const t = ((time % this.duration) + this.duration) % this.duration;
    let low = 0;
    let high = this.frameStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.frameStarts[mid]! <= t) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  private static async openAnimated(file: File): Promise<ImageSource | null> {
    const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount < 2) {
      decoder.close();
      return null;
    }
    await decoder.completed;

    const frameStarts: Micros[] = [];
    let time = 0;
    let width = 0;
    let height = 0;
    for (let index = 0; index < track.frameCount; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      frameStarts.push(time);
      // GIFs often say 0 for "as fast as possible"; browsers show those at 10 fps.
      time += image.duration && image.duration > 10_000 ? image.duration : 100_000;
      width = image.displayWidth;
      height = image.displayHeight;
      image.close();
    }
    return new ImageSource(width, height, null, decoder, frameStarts, time);
  }
}
