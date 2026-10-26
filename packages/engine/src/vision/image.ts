/** A greyscale image, one float per pixel from 0 to 255, rows top to bottom. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export type Point = readonly [number, number];

/** BT.601 luma from RGBA pixels, which is all motion analysis needs. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
  }
  return { width, height, data };
}

/** Halves an image after a [1 4 6 4 1] blur, so detail too fine for the smaller size doesn't alias. */
export function downsample(image: GrayImage): GrayImage {
  const { width, height, data } = image;
  const blurred = new Float32Array(width * height);
  const row = new Float32Array(width * height);
  const at = (x: number, max: number) => Math.min(max - 1, Math.max(0, x));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width;
      row[i + x] =
        (data[i + at(x - 2, width)]! + 4 * data[i + at(x - 1, width)]! + 6 * data[i + x]! + 4 * data[i + at(x + 1, width)]! + data[i + at(x + 2, width)]!) / 16;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      blurred[y * width + x] =
        (row[at(y - 2, height) * width + x]! +
          4 * row[at(y - 1, height) * width + x]! +
          6 * row[y * width + x]! +
          4 * row[at(y + 1, height) * width + x]! +
          row[at(y + 2, height) * width + x]!) /
        16;
    }
  }
  const half = { width: Math.max(1, width >> 1), height: Math.max(1, height >> 1) };
  const out = new Float32Array(half.width * half.height);
  for (let y = 0; y < half.height; y++) {
    for (let x = 0; x < half.width; x++) out[y * half.width + x] = blurred[2 * y * width + 2 * x]!;
  }
  return { ...half, data: out };
}

/** The image and successively halved copies, finest first. */
export function pyramid(image: GrayImage, levels: number): GrayImage[] {
  const result = [image];
  while (result.length < levels && result.at(-1)!.width > 16 && result.at(-1)!.height > 16) result.push(downsample(result.at(-1)!));
  return result;
}

/** The value between pixels, interpolated from the four around it; edges repeat. */
export function sampleAt(image: GrayImage, x: number, y: number): number {
  const { width, height, data } = image;
  const cx = Math.min(width - 1.001, Math.max(0, x));
  const cy = Math.min(height - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * width + x0;
  const top = data[i]! + (data[i + 1]! - data[i]!) * fx;
  const bottom = data[i + width]! + (data[i + width + 1]! - data[i + width]!) * fx;
  return top + (bottom - top) * fy;
}

/** Horizontal and vertical brightness change at each pixel, by central differences. */
export function gradients(image: GrayImage): { gx: Float32Array; gy: Float32Array } {
  const { width, height, data } = image;
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      gx[i] = (data[y * width + Math.min(width - 1, x + 1)]! - data[y * width + Math.max(0, x - 1)]!) / 2;
      gy[i] = (data[Math.min(height - 1, y + 1) * width + x]! - data[Math.max(0, y - 1) * width + x]!) / 2;
    }
  }
  return { gx, gy };
}
