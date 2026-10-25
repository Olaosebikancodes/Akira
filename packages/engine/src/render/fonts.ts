/** A font that ships with Akira, by family and the weights it comes in. */
export interface BuiltInFont {
  family: string;
  /** File name stem: files are `<stem>-<weight>.woff2` under the font base URL. */
  stem: string;
  weights: readonly (400 | 700)[];
}

export const BUILT_IN_FONTS: readonly BuiltInFont[] = [
  { family: "Inter", stem: "inter", weights: [400, 700] },
  { family: "Montserrat", stem: "montserrat", weights: [400, 700] },
  { family: "Poppins", stem: "poppins", weights: [400, 700] },
  { family: "Bebas Neue", stem: "bebas-neue", weights: [400] },
  { family: "Anton", stem: "anton", weights: [400] },
  { family: "Playfair Display", stem: "playfair-display", weights: [400, 700] },
  { family: "Pacifico", stem: "pacifico", weights: [400] },
  { family: "Permanent Marker", stem: "permanent-marker", weights: [400] },
];

const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

let fontBaseUrl: string | null = null;
const registered = new Set<string>();

/**
 * Where the built-in font files are served from, as an absolute URL ending
 * in "/". Set once in every thread that draws text: the page, the render
 * worker and the export worker.
 */
export function setFontBaseUrl(url: string): void {
  fontBaseUrl = url;
}

/**
 * The fonts the current thread draws with: the page's document fonts, or a
 * worker's own. Pages must use `document.fonts`: `window.fonts` can be any
 * element with id="fonts", since ids become globals.
 */
function fontSet(): FontFaceSet {
  if (typeof document !== "undefined") return document.fonts;
  return (globalThis as unknown as { fonts: FontFaceSet }).fonts;
}

export function isFontFile(file: File): boolean {
  return file.type.startsWith("font/") || FONT_FILE.test(file.name);
}

/** "Brand_Font-Bold.otf" becomes "Brand Font-Bold": the family text clips use for it. */
export function fontFamilyFromFileName(name: string): string {
  return name.replace(FONT_FILE, "").replace(/[_]+/g, " ").trim() || "Imported font";
}

/** Registers an imported font file in the current thread and returns its family. */
export async function registerFontFile(file: File): Promise<string> {
  const family = fontFamilyFromFileName(file.name);
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  fontSet().add(face);
  registered.add(family);
  return family;
}

/**
 * Makes sure a family is ready to draw with. Built-in fonts are fetched on
 * first use; imported fonts must already be registered. Without this a
 * canvas silently falls back to a default font.
 */
export async function ensureFont(family: string, bold: boolean, italic: boolean): Promise<void> {
  const builtIn = BUILT_IN_FONTS.find((font) => font.family === family);
  if (builtIn && fontBaseUrl && !registered.has(family)) {
    registered.add(family);
    for (const weight of builtIn.weights) {
      fontSet().add(new FontFace(family, `url(${fontBaseUrl}${builtIn.stem}-${weight}.woff2)`, { weight: String(weight) }));
    }
  }
  await fontSet().load(fontShorthand(family, 16, bold, italic));
}

/** A CSS font shorthand for canvas text. Fonts without a bold file are emboldened by the browser. */
export function fontShorthand(family: string, size: number, bold: boolean, italic: boolean): string {
  return `${italic ? "italic " : ""}${bold ? 700 : 400} ${size}px "${family}", sans-serif`;
}
