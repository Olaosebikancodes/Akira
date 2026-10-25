/**
 * Time in Akira is always an integer number of microseconds. It matches the
 * timestamps WebCodecs uses and never accumulates floating-point error the way
 * seconds would.
 */
export type Micros = number;

/**
 * A frame rate as an exact fraction. NTSC rates aren't whole numbers:
 * 29.97 fps is really 30000/1001, and rounding it to a decimal makes cuts
 * drift over a long timeline.
 */
export interface FrameRate {
  readonly num: number;
  readonly den: number;
}

export const MICROS_PER_SECOND = 1_000_000;

export const FPS_23_976: FrameRate = { num: 24000, den: 1001 };
export const FPS_24: FrameRate = { num: 24, den: 1 };
export const FPS_25: FrameRate = { num: 25, den: 1 };
export const FPS_29_97: FrameRate = { num: 30000, den: 1001 };
export const FPS_30: FrameRate = { num: 30, den: 1 };
export const FPS_50: FrameRate = { num: 50, den: 1 };
export const FPS_59_94: FrameRate = { num: 60000, den: 1001 };
export const FPS_60: FrameRate = { num: 60, den: 1 };

const STANDARD_RATES = [
  FPS_23_976,
  FPS_24,
  FPS_25,
  FPS_29_97,
  FPS_30,
  FPS_50,
  FPS_59_94,
  FPS_60,
];

export function secondsToMicros(seconds: number): Micros {
  return Math.round(seconds * MICROS_PER_SECOND);
}

export function microsToSeconds(micros: Micros): number {
  return micros / MICROS_PER_SECOND;
}

export function frameRateToNumber(rate: FrameRate): number {
  return rate.num / rate.den;
}

/**
 * Start time of a frame, rounded to the nearest microsecond (halves round
 * down, which keeps it consistent with `microsToFrame`).
 *
 * Splitting the frame index into whole cycles of `rate.num` frames and a
 * remainder keeps every intermediate value far below 2^53, so this stays exact
 * for timelines far longer than anyone will edit.
 */
export function frameToMicros(frame: number, rate: FrameRate): Micros {
  const wholeCycles = Math.floor(frame / rate.num);
  const remainder = frame - wholeCycles * rate.num;
  const partial = (remainder * MICROS_PER_SECOND * rate.den) / rate.num;
  return (
    wholeCycles * MICROS_PER_SECOND * rate.den + Math.ceil(partial - 0.5)
  );
}

/**
 * Index of the frame that is on screen at `micros`.
 *
 * Frame start times are rounded to whole microseconds, and decoders round or
 * truncate their timestamps in their own ways. Measuring in half-microseconds
 * and adding one treats anything within half a microsecond of a frame's exact
 * start as that frame, which makes `microsToFrame(frameToMicros(n)) === n`
 * hold for every frame.
 */
export function microsToFrame(micros: Micros, rate: FrameRate): number {
  const cycle = 2 * MICROS_PER_SECOND * rate.den;
  const halfMicros = 2 * micros + 1;
  const wholeCycles = Math.floor(halfMicros / cycle);
  const remainder = halfMicros - wholeCycles * cycle;
  return wholeCycles * rate.num + Math.floor((remainder * rate.num) / cycle);
}

/** Moves a time back to the start of the frame it falls in. */
export function snapToFrame(micros: Micros, rate: FrameRate): Micros {
  return frameToMicros(microsToFrame(micros, rate), rate);
}

/**
 * Turns a measured frame rate such as 29.97002997 into an exact fraction.
 * Containers usually only expose an average, so this recovers the standard
 * rate it came from and falls back to a /1000 fraction for anything unusual.
 */
export function frameRateFromNumber(fps: number): FrameRate {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`Invalid frame rate: ${fps}`);
  }
  for (const rate of STANDARD_RATES) {
    if (Math.abs(frameRateToNumber(rate) - fps) < 0.01) return rate;
  }
  const rounded = Math.round(fps);
  if (Math.abs(rounded - fps) < 0.001) return { num: rounded, den: 1 };
  return { num: Math.round(fps * 1000), den: 1000 };
}

/**
 * Formats a time as `HH:MM:SS:FF`, the way editors label the playhead.
 * Frames are counted without drop-frame, so at 29.97 fps the label runs
 * slightly behind the wall clock, as it does in most editors.
 */
export function formatTimecode(micros: Micros, rate: FrameRate): string {
  const frame = microsToFrame(Math.max(0, micros), rate);
  const framesPerSecond = Math.round(frameRateToNumber(rate));
  const totalSeconds = Math.floor(frame / framesPerSecond);
  const frames = frame % framesPerSecond;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds, frames]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
