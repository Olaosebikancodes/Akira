/**
 * Auto levels and white balance as black and white points per channel, 0 to 1.
 * Applied as `(colour - black) / (white - black)`.
 */
export interface ColorCorrection {
  black: [number, number, number];
  white: [number, number, number];
}

export const NO_CORRECTION: ColorCorrection = { black: [0, 0, 0], white: [1, 1, 1] };

/** Ignore this share of the darkest and brightest pixels, so specks and highlights don't decide. */
const CLIP = 0.005;
/** Never stretch a channel by more than this, so a nearly flat frame isn't blown out. */
const MAX_GAIN = 2.5;

/**
 * Works out a correction from RGBA pixels, usually a few small frames from
 * across a clip. Each channel is stretched on its own, from its 0.5th to its
 * 99.5th percentile: that lifts dull, washed-out footage and, because the
 * channels move independently, also removes a colour cast.
 */
export function analyzeColor(pixels: Uint8ClampedArray | Uint8Array): ColorCorrection {
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    // Skip transparent pixels: they aren't part of the picture.
    if (pixels[i + 3]! < 128) continue;
    histograms[0]![pixels[i]!]!++;
    histograms[1]![pixels[i + 1]!]!++;
    histograms[2]![pixels[i + 2]!]!++;
    count++;
  }
  if (count === 0) return NO_CORRECTION;

  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [1, 1, 1];
  histograms.forEach((histogram, channel) => {
    let low = percentile(histogram, count, CLIP) / 255;
    let high = percentile(histogram, count, 1 - CLIP) / 255;
    if (high - low < 1 / MAX_GAIN) {
      // Too little range to stretch fully: widen it evenly around its middle.
      const middle = (low + high) / 2;
      low = Math.max(0, middle - 0.5 / MAX_GAIN);
      high = Math.min(1, low + 1 / MAX_GAIN);
    }
    black[channel] = low;
    white[channel] = high;
  });
  return { black, white };
}

/** The value below which `fraction` of the pixels fall. */
function percentile(histogram: Uint32Array, count: number, fraction: number): number {
  const target = fraction * count;
  let seen = 0;
  for (let value = 0; value < 256; value++) {
    seen += histogram[value]!;
    if (seen > target) return value;
  }
  return 255;
}

/** Applies a correction to one 0-1 channel value, as the shader does. */
export function correctChannel(value: number, correction: ColorCorrection, channel: 0 | 1 | 2): number {
  const black = correction.black[channel];
  const white = correction.white[channel];
  return Math.min(1, Math.max(0, (value - black) / Math.max(1e-6, white - black)));
}
