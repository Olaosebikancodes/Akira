"use client";

import { BUILT_IN_FONTS, ensureFont, fontShorthand, type TextStyle } from "@akira/engine";
import { ClosedCaptioningIcon, TextAaIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { type ChangeEvent, type CSSProperties, useEffect, useId, useMemo } from "react";
import { addText } from "./actions";
import { importCaptions, importFiles, useEditor } from "./store";
import { CAPTION_PRESET, TEXT_PRESETS } from "./text-presets";
import { focusRing } from "./ui";

export function TextPanel() {
  const assets = useEditor((s) => s.project.assets);
  const importedFonts = useMemo(
    () => Object.values(assets).flatMap((asset) => (asset.font ? [asset.font.family] : [])),
    [assets],
  );
  const captionsId = useId();
  const fontId = useId();
  const headings = useId();

  // Load the bundled fonts into the page so the presets and font list show in their own faces.
  useEffect(() => {
    for (const font of BUILT_IN_FONTS) void ensureFont(font.family, false, false);
  }, []);

  function onCaptions(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importCaptions(file);
  }

  function onFont(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) void importFiles(files);
  }

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <section aria-labelledby={`${headings}-styles`} className="flex flex-col gap-2 p-3">
        <h3 id={`${headings}-styles`} className="px-1 text-xs font-semibold text-muted">
          Add text
        </h3>
        <ul className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                aria-label={`Add ${preset.label} text`}
                onClick={() => addText(preset.style)}
                className={`press flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-md bg-stage px-2 hover:bg-raised ${focusRing}`}
              >
                <span aria-hidden style={previewStyle(preset.style)} className="truncate">
                  {preset.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${headings}-captions`} className="flex flex-col gap-2 border-t border-border p-3">
        <h3 id={`${headings}-captions`} className="px-1 text-xs font-semibold text-muted">
          Captions
        </h3>
        <button
          type="button"
          onClick={() => addText(CAPTION_PRESET.style, "Caption", { caption: true })}
          className={`press flex h-8 items-center gap-2 rounded-md bg-raised px-3 text-xs font-medium hover:bg-raised-hover ${focusRing}`}
        >
          <ClosedCaptioningIcon size={15} aria-hidden />
          Add caption
        </button>
        <input id={captionsId} type="file" accept=".srt" className="peer sr-only" onChange={onCaptions} />
        <label
          htmlFor={captionsId}
          className="press flex h-8 cursor-pointer items-center gap-2 rounded-md bg-raised px-3 text-xs font-medium hover:bg-raised-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
        >
          <UploadSimpleIcon size={15} aria-hidden />
          Import captions (.srt)
        </label>
        <p className="px-1 text-[11px] text-subtle">Each caption becomes a text clip you can restyle and retime.</p>
      </section>

      <section aria-labelledby={`${headings}-fonts`} className="flex flex-col gap-2 border-t border-border p-3">
        <div className="flex items-center justify-between px-1">
          <h3 id={`${headings}-fonts`} className="text-xs font-semibold text-muted">
            Fonts
          </h3>
          <input id={fontId} type="file" accept=".ttf,.otf,.woff,.woff2" multiple className="peer sr-only" onChange={onFont} />
          <label
            htmlFor={fontId}
            className="press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted hover:bg-raised hover:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
          >
            <TextAaIcon size={14} aria-hidden />
            Import font
          </label>
        </div>
        <ul className="flex flex-col">
          {[...importedFonts, ...BUILT_IN_FONTS.map((font) => font.family)].map((family) => (
            <li
              key={family}
              className="truncate rounded px-1 py-1 text-[15px] text-foreground"
              style={{ fontFamily: `"${family}", sans-serif` }}
            >
              {family}
              {importedFonts.includes(family) && <span className="ml-2 font-sans text-[11px] text-subtle">Imported</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A CSS approximation of a text style, for the preset buttons. */
function previewStyle(style: TextStyle): CSSProperties {
  const size = 20;
  return {
    font: fontShorthand(style.font, size, style.bold, style.italic),
    color: style.color,
    WebkitTextStroke: style.stroke ? `${style.stroke.width * size}px ${style.stroke.color}` : undefined,
    paintOrder: "stroke fill",
    textShadow: style.shadow
      ? `${style.shadow.offsetX * size}px ${style.shadow.offsetY * size}px ${style.shadow.blur * size}px ${style.shadow.color}`
      : undefined,
    background: style.background?.color,
    padding: style.background ? `${style.background.padding * size * 0.6}px ${style.background.padding * size}px` : undefined,
    borderRadius: style.background ? style.background.radius * size : undefined,
  };
}
