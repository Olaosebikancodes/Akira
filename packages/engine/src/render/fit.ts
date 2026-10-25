export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Largest rectangle with the source's aspect ratio that fits inside the
 * destination, centred. This is how a clip is placed before the user moves or
 * scales it.
 */
export function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
): Rect {
  const scale = Math.min(destWidth / sourceWidth, destHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (destWidth - width) / 2,
    y: (destHeight - height) / 2,
    width,
    height,
  };
}
