export type Rgb = readonly [number, number, number];

/** Parses `#rrggbb` into 0-1 channels. Anything else falls back to black. */
export function parseHexColor(hex: string): Rgb {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return [0, 0, 0];
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255,
  ];
}
