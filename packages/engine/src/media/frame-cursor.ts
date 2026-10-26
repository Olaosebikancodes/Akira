import type { VideoSample, VideoSampleSink } from "mediabunny";
import { type Micros, microsToSeconds } from "../time";

/**
 * Decoding forward is cheap; jumping means decoding again from the previous
 * keyframe. Requests further ahead than this restart the decoder rather than
 * decoding every frame in between.
 */
const MAX_FORWARD_DECODE: Micros = 2_000_000;

/**
 * Hands out the frame visible at a source time, decoding forward from the
 * previous request whenever it can. Playback and export ask for steadily
 * increasing times, so most requests cost a single decoded frame.
 *
 * The cursor owns the frames it returns. A frame stays valid until the next
 * call to `frameAt` or `close`, and calls must not overlap.
 */
export class VideoFrameCursor {
  private samples: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private current: VideoSample | null = null;
  private upcoming: VideoSample | null = null;

  constructor(readonly sink: VideoSampleSink) {}

  async frameAt(time: Micros): Promise<VideoSample | null> {
    if (this.needsRestart(time)) await this.restart(time);
    while (this.upcoming && this.upcoming.microsecondTimestamp <= time) {
      this.current?.close();
      this.current = this.upcoming;
      this.upcoming = await this.pull();
    }
    return this.current;
  }

  /** The frame after the last one `frameAt` returned, for blending between them. Owned like `frameAt`'s. */
  get next(): VideoSample | null {
    return this.upcoming;
  }

  async close(): Promise<void> {
    await this.reset();
  }

  private needsRestart(time: Micros): boolean {
    if (!this.samples || !this.current) return true;
    const shown = this.current.microsecondTimestamp;
    return time < shown || time - shown > MAX_FORWARD_DECODE;
  }

  private async restart(time: Micros): Promise<void> {
    await this.reset();
    // Starts with the frame visible at `time`, not the first one after it.
    this.samples = this.sink.samples(microsToSeconds(time));
    this.current = await this.pull();
    this.upcoming = this.current && (await this.pull());
  }

  private async pull(): Promise<VideoSample | null> {
    const result = await this.samples?.next();
    return result && !result.done ? result.value : null;
  }

  private async reset(): Promise<void> {
    this.current?.close();
    this.upcoming?.close();
    this.current = null;
    this.upcoming = null;
    await this.samples?.return();
    this.samples = null;
  }
}
