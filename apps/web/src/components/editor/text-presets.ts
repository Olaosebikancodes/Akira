import { CAPTION_STYLE, DEFAULT_TEXT_STYLE, type TextStyle } from "@akira/engine";

export interface TextPreset {
  id: string;
  label: string;
  style: TextStyle;
}

/** Starting looks for new text. Every setting can be changed afterwards in the inspector. */
export const TEXT_PRESETS: readonly TextPreset[] = [
  { id: "title", label: "Title", style: DEFAULT_TEXT_STYLE },
  {
    id: "outline",
    label: "Outline",
    style: { ...DEFAULT_TEXT_STYLE, font: "Montserrat", shadow: null, stroke: { color: "#000000", width: 0.08 } },
  },
  {
    id: "boxed",
    label: "Boxed",
    style: {
      ...DEFAULT_TEXT_STYLE,
      font: "Poppins",
      shadow: null,
      background: { color: "#e5383b", opacity: 1, padding: 0.28, radius: 0.14 },
    },
  },
  {
    id: "impact",
    label: "Impact",
    style: { ...DEFAULT_TEXT_STYLE, font: "Anton", bold: false, size: 0.11, shadow: null, stroke: { color: "#000000", width: 0.06 } },
  },
  {
    id: "glow",
    label: "Glow",
    style: {
      ...DEFAULT_TEXT_STYLE,
      font: "Bebas Neue",
      bold: false,
      size: 0.1,
      color: "#eafff6",
      shadow: { color: "#3ddc97", blur: 0.35, offsetX: 0, offsetY: 0 },
    },
  },
  { id: "script", label: "Script", style: { ...DEFAULT_TEXT_STYLE, font: "Pacifico", bold: false, size: 0.075 } },
  { id: "marker", label: "Marker", style: { ...DEFAULT_TEXT_STYLE, font: "Permanent Marker", bold: false, color: "#ffd60a" } },
  { id: "serif", label: "Serif", style: { ...DEFAULT_TEXT_STYLE, font: "Playfair Display", italic: true } },
];

export const CAPTION_PRESET: TextPreset = { id: "caption", label: "Caption", style: CAPTION_STYLE };
