import type { ClipText } from "../project/model";
import { ensureFont, fontShorthand } from "./fonts";
import { layoutText, revealedCharacters, type TextLayout } from "./text-layout";

/** Text is drawn no larger than this, which keeps the drawing within texture limits. */
export const MAX_FONT_SIZE = 600;

/** Applies a style's font settings to a 2D context, for measuring or drawing. */
function applyFont(context: OffscreenCanvasRenderingContext2D, text: ClipText, fontSize: number): void {
  const { style } = text;
  context.font = fontShorthand(style.font, fontSize, style.bold, style.italic);
  context.letterSpacing = `${style.letterSpacing * fontSize}px`;
}

/** Lays text out with real font metrics, without drawing it. */
export function measureText(text: ClipText, fontSize: number): TextLayout {
  const context = new OffscreenCanvas(1, 1).getContext("2d")!;
  applyFont(context, text, fontSize);
  return layoutText(text.content, text.style, fontSize, (line) => context.measureText(line).width);
}

/**
 * Draws a text clip at `fontSize` pixels: background box, then each line's
 * outline and fill, with the shadow on the outermost layer. `reveal` (0 to 1)
 * shows only the first part of the text, for the typewriter animation;
 * characters are drawn where they'd be in the full text, so centred lines
 * don't shift as they type out.
 */
export async function rasterizeText(text: ClipText, fontSize: number, reveal = 1): Promise<OffscreenCanvas> {
  const { style } = text;
  const size = Math.min(MAX_FONT_SIZE, fontSize);
  await ensureFont(style.font, style.bold, style.italic);

  const layout = measureText(text, size);
  const canvas = new OffscreenCanvas(Math.max(1, layout.width), Math.max(1, layout.height));
  const context = canvas.getContext("2d")!;

  if (style.background) {
    const { box } = layout;
    context.globalAlpha = style.background.opacity;
    context.fillStyle = style.background.color;
    context.beginPath();
    context.roundRect(box.x, box.y, box.width, box.height, style.background.radius * size);
    context.fill();
    context.globalAlpha = 1;
  }

  applyFont(context, text, size);
  context.textBaseline = "middle";
  context.lineJoin = "round";
  const shadow = () => {
    if (!style.shadow) return;
    context.shadowColor = style.shadow.color;
    context.shadowBlur = style.shadow.blur * size;
    context.shadowOffsetX = style.shadow.offsetX * size;
    context.shadowOffsetY = style.shadow.offsetY * size;
  };
  const noShadow = () => {
    context.shadowColor = "transparent";
  };

  let remaining = revealedCharacters(text.content, reveal);
  for (const line of layout.lines) {
    const visible = line.text.slice(0, Math.max(0, remaining));
    remaining -= line.text.length;
    if (!visible) continue;
    if (style.stroke) {
      // Strokes are centred on the outline, so double the width to get it all outside.
      shadow();
      context.lineWidth = style.stroke.width * size * 2;
      context.strokeStyle = style.stroke.color;
      context.strokeText(visible, line.x, line.y);
      noShadow();
    } else {
      shadow();
    }
    context.fillStyle = style.color;
    context.fillText(visible, line.x, line.y);
    noShadow();
  }
  return canvas;
}
