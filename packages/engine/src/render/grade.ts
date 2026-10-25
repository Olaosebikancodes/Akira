import type { Adjustments } from "../project/model";
import type { Rgb } from "./color";

/**
 * The adjustments part of the GRADE shader, on the CPU, for previews such
 * as filter swatches. Keep the two in step: same order, same constants.
 * Vignette depends on position, so it's left out.
 */
export function gradeColor(color: Rgb, adjust: Adjustments): Rgb {
  const exposure = 2 ** (adjust.exposure * 2);
  let c = [
    color[0] * exposure * (1 + adjust.temperature * 0.25),
    color[1] * exposure * (1 + adjust.tint * 0.2),
    color[2] * exposure * (1 - adjust.temperature * 0.25),
  ];
  const l = luma(c);
  const shadows = adjust.shadows * 0.4 * (1 - smoothstep(0, 0.55, l));
  const highlights = adjust.highlights * 0.4 * smoothstep(0.45, 1, l);
  c = c.map((v) => v + shadows + highlights + adjust.brightness * 0.3);
  c = c.map((v) => (v - 0.5) * (1 + adjust.contrast) + 0.5);
  const grey = luma(c);
  c = c.map((v) => grey + (v - grey) * (1 + adjust.saturation));
  return [clamp01(c[0]!), clamp01(c[1]!), clamp01(c[2]!)];
}

function luma(c: readonly number[]): number {
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
