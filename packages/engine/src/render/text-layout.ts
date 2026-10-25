import type { TextStyle } from "../project/model";

export interface TextLine {
  text: string;
  /** Left edge of the line, in pixels from the left of the drawing. */
  x: number;
  /** Vertical middle of the line, in pixels from the top of the drawing. */
  y: number;
  width: number;
}

export interface TextLayout {
  fontSize: number;
  lines: TextLine[];
  /** The background box, or where it would be: the text plus its padding. */
  box: { x: number; y: number; width: number; height: number };
  /** Size of the whole drawing, with room around the box for outlines and shadows. */
  width: number;
  height: number;
}

/**
 * Lays text out line by line. `measure` returns a string's width in pixels
 * with the style's font already applied, which keeps this testable without
 * a browser.
 */
export function layoutText(
  content: string,
  style: TextStyle,
  fontSize: number,
  measure: (text: string) => number,
): TextLayout {
  const texts = content.split("\n");
  const widths = texts.map((text) => (text ? measure(text) : 0));
  const advance = fontSize * style.lineHeight;
  const blockWidth = Math.max(1, ...widths);
  const blockHeight = texts.length * advance;
  const padding = style.background ? style.background.padding * fontSize : 0;

  const stroke = style.stroke ? style.stroke.width * fontSize : 0;
  const shadow = style.shadow
    ? (style.shadow.blur * 2 + Math.max(Math.abs(style.shadow.offsetX), Math.abs(style.shadow.offsetY))) * fontSize
    : 0;
  const margin = Math.ceil(stroke + shadow + 2);

  const box = { x: margin, y: margin, width: blockWidth + padding * 2, height: blockHeight + padding * 2 };
  const lines = texts.map((text, index) => {
    const width = widths[index]!;
    const offset = style.align === "left" ? 0 : style.align === "right" ? blockWidth - width : (blockWidth - width) / 2;
    return { text, width, x: box.x + padding + offset, y: box.y + padding + (index + 0.5) * advance };
  });

  return { fontSize, lines, box, width: Math.ceil(box.width + margin * 2), height: Math.ceil(box.height + margin * 2) };
}

/** How many characters a typewriter reveal shows: `reveal` of the total, ignoring line breaks. */
export function revealedCharacters(content: string, reveal: number): number {
  const total = content.replace(/\n/g, "").length;
  return Math.round(Math.min(1, Math.max(0, reveal)) * total);
}
