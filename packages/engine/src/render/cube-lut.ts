/** A 3D colour lookup table: for each input colour on a grid, the colour to output. */
export interface CubeLut {
  title: string;
  /** Grid points per axis, e.g. 33 for a 33×33×33 table. */
  size: number;
  /** Output colours, red varying fastest, then green, then blue: index = r + g·size + b·size². */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export class LutError extends Error {
  override name = "LutError";
}

/**
 * Reads an Adobe/Resolve .cube file, the format colour-grading LUTs are sold
 * in. Only 3D tables are supported; 1D tables are rejected with a clear message.
 */
export function parseCube(source: string): CubeLut {
  let title = "";
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (const raw of source.replace(/^﻿/, "").split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    switch (keyword) {
      case "TITLE":
        title = line.slice("TITLE".length).trim().replace(/^"|"$/g, "");
        continue;
      case "LUT_1D_SIZE":
        throw new LutError("This is a 1D LUT. Akira supports 3D .cube LUTs, which is what colour grading LUTs usually are.");
      case "LUT_3D_SIZE":
        size = Number(rest[0]);
        continue;
      case "DOMAIN_MIN":
        domainMin = triple(rest);
        continue;
      case "DOMAIN_MAX":
        domainMax = triple(rest);
        continue;
      case "LUT_1D_INPUT_RANGE":
      case "LUT_3D_INPUT_RANGE":
        // Resolve's older way of writing the domain: one range for all channels.
        domainMin = [Number(rest[0]), Number(rest[0]), Number(rest[0])];
        domainMax = [Number(rest[1]), Number(rest[1]), Number(rest[1])];
        continue;
    }
    if (/^[-+.\d]/.test(keyword!)) {
      const [r, g, b] = line.split(/\s+/).map(Number);
      if ([r, g, b].some((value) => value === undefined || Number.isNaN(value))) {
        throw new LutError(`This .cube file has a line that isn't three numbers: "${line}".`);
      }
      values.push(r!, g!, b!);
    }
    // Any other keyword is metadata some tools add; it doesn't change the table.
  }

  if (!Number.isInteger(size) || size < 2 || size > 256) {
    throw new LutError("This .cube file doesn't say how big its table is (LUT_3D_SIZE).");
  }
  if (values.length !== size ** 3 * 3) {
    throw new LutError(`This .cube file should have ${size ** 3} colours but has ${values.length / 3}.`);
  }
  return { title, size, data: Float32Array.from(values), domainMin, domainMax };
}

function triple(parts: string[]): [number, number, number] {
  const [a, b, c] = parts.map(Number);
  if ([a, b, c].some((value) => value === undefined || Number.isNaN(value))) {
    throw new LutError("This .cube file has a DOMAIN line that isn't three numbers.");
  }
  return [a!, b!, c!];
}

/** The output colour for an input on the grid, for tests and previews. */
export function lutAt(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const index = (r + g * lut.size + b * lut.size * lut.size) * 3;
  return [lut.data[index]!, lut.data[index + 1]!, lut.data[index + 2]!];
}
