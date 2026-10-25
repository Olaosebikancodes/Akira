"use client";

import {
  type Adjustments,
  type BackgroundFill,
  Compositor,
  type EffectKind,
  gradeColor,
  type Layer,
  loadTransitions,
  NEUTRAL_ADJUSTMENTS,
  NO_CROP,
  type Picture,
  type TransitionDefinition,
} from "@akira/engine";
import {
  CheckIcon,
  CircleHalfIcon,
  DropIcon,
  FilmReelIcon,
  type Icon,
  LightningIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  TelevisionIcon,
  UploadSimpleIcon,
  VibrateIcon,
} from "@phosphor-icons/react";
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { addEffect, applyFilter, applyLut, applyTransition, EFFECTS, FILTERS } from "./look";
import { importFiles, useEditor } from "./store";
import { focusRing, Segmented } from "./ui";

type View = "transitions" | "effects" | "filters";

/** Transitions, effects and filters, each applied to the selected clip with a click. */
export function EffectsPanel() {
  const [view, setView] = useState<View>("transitions");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <Segmented
          label="Effects library"
          value={view}
          options={[
            { value: "transitions", label: "Transitions" },
            { value: "effects", label: "Effects" },
            { value: "filters", label: "Filters" },
          ]}
          onChange={setView}
        />
      </div>
      {view === "transitions" ? <TransitionList /> : view === "effects" ? <EffectList /> : <FilterList />}
    </div>
  );
}

/** The transition catalogue, loaded the first time something needs it. */
export function useTransitions(): readonly TransitionDefinition[] | null {
  const [list, setList] = useState<readonly TransitionDefinition[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadTransitions().then((catalog) => {
      if (live) setList([...catalog.values()]);
    });
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** The ones people reach for most, shown first. */
const FEATURED = ["Fade", "FadeColor", "SimpleZoom", "Directional", "WipeLeft", "CrossZoom", "CircleOpen", "Dreamy", "GlitchMemories", "Swirl", "Cube", "Pixelize"];

function TransitionList() {
  const transitions = useTransitions();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const needle = query.trim().toLowerCase();
  const shown = (transitions ?? [])
    .filter((t) => !needle || t.label.toLowerCase().includes(needle) || t.tags.some((tag) => tag.includes(needle)))
    .sort((a, b) => rank(a) - rank(b));

  return (
    <>
      <div className="relative mx-3 mt-3 shrink-0">
        <label htmlFor={searchId} className="sr-only">
          Search transitions
        </label>
        <MagnifyingGlassIcon size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search transitions"
          className={`h-8 w-full rounded-md border border-border bg-raised pl-7 pr-2 text-xs text-foreground placeholder:text-subtle ${focusRing}`}
        />
      </div>
      <p className="shrink-0 px-4 pt-2 text-[11px] text-subtle">Click to put one between the selected clip and the next.</p>
      {!transitions ? (
        <p className="px-4 py-3 text-xs text-muted">Loading transitions…</p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted">No transitions match “{query}”.</p>
      ) : (
        <ul aria-label="Transitions" className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto p-3">
          {shown.map((definition) => (
            <li key={definition.name}>
              <TransitionTile definition={definition} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function rank(definition: TransitionDefinition): number {
  const featured = FEATURED.indexOf(definition.name);
  return featured === -1 ? FEATURED.length : featured;
}

function TransitionTile({ definition }: { definition: TransitionDefinition }) {
  const [previewing, setPreviewing] = useState(false);
  return (
    <button
      type="button"
      onClick={() => applyTransition(definition.name)}
      onPointerEnter={() => setPreviewing(true)}
      onPointerLeave={() => setPreviewing(false)}
      onFocus={() => setPreviewing(true)}
      onBlur={() => setPreviewing(false)}
      className={`press group flex w-full min-w-0 flex-col gap-1.5 rounded-md text-left ${focusRing}`}
    >
      <span className="relative block aspect-video overflow-hidden rounded-md bg-raised ring-accent group-hover:ring-2">
        <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: "linear-gradient(135deg, #f2994a, #eb5757)" }} aria-hidden />
        <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: "linear-gradient(135deg, #2d9cdb, #1b4f9c)" }} aria-hidden />
        {previewing && <TransitionPreview definition={definition} />}
      </span>
      <span className="truncate text-xs text-muted group-hover:text-foreground">{definition.label}</span>
    </button>
  );
}

const PREVIEW_WIDTH = 192;
const PREVIEW_HEIGHT = 108;
const BLACK: BackgroundFill = { kind: "color", color: [0, 0, 0] };
let samples: [Picture, Picture] | null = null;

/** Two labelled gradients for transitions to play between. */
function samplePictures(): [Picture, Picture] {
  samples ??= [samplePicture("A", "#f2994a", "#eb5757"), samplePicture("B", "#2d9cdb", "#1b4f9c")];
  return samples;
}

function samplePicture(letter: string, from: string, to: string): Picture {
  const canvas = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  context.fillStyle = gradient;
  context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font = "600 54px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(letter, PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2 + 2);
  return { source: canvas, displayWidth: PREVIEW_WIDTH, displayHeight: PREVIEW_HEIGHT, rotation: 0, flip: false, cacheKey: `sample:${letter}` };
}

function sampleLayer(picture: Picture): Layer {
  return {
    picture,
    model: new Float32Array([PREVIEW_WIDTH, 0, 0, 0, PREVIEW_HEIGHT, 0, 0, 0, 1]),
    texture: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    crop: NO_CROP,
    opacity: 1,
    processing: null,
    mask: null,
    blend: "normal",
  };
}

/** Plays the transition on a loop while the tile is hovered or focused, using the real renderer. */
function TransitionPreview({ definition }: { definition: TransitionDefinition }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    // A fresh canvas each time: disposing gives its WebGL context back to the
    // browser, and a canvas never hands out a second context.
    const canvas = document.createElement("canvas");
    canvas.className = "size-full";
    container.append(canvas);
    let compositor: Compositor;
    try {
      compositor = new Compositor(canvas);
    } catch {
      canvas.remove();
      return;
    }
    compositor.resize(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    const [from, to] = samplePictures().map(sampleLayer) as [Layer, Layer];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      // A second of transition, then a moment on the result before it repeats.
      const progress = still ? 0.5 : Math.min(1, ((now - start) % 1600) / 1000);
      try {
        compositor.render(BLACK, [{ kind: "transition", from, to, definition, progress }]);
      } catch {
        // A preview that can't draw just shows the still tile underneath.
        canvas.remove();
        return;
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      compositor.dispose();
      canvas.remove();
    };
  }, [definition]);
  return <span ref={ref} aria-hidden className="absolute inset-0" />;
}

const EFFECT_ICONS: Record<EffectKind, Icon> = {
  blur: DropIcon,
  shake: VibrateIcon,
  glitch: LightningIcon,
  vhs: TelevisionIcon,
  grain: FilmReelIcon,
  flash: CircleHalfIcon,
};

function EffectList() {
  const applied = useEditor((s) => {
    if (s.selection.length !== 1) return "";
    const clip = s.project.tracks.flatMap((track) => track.clips).find((c) => c.id === s.selection[0]);
    return (clip?.effects ?? []).map((effect) => effect.kind).join(" ");
  });
  return (
    <>
      <p className="shrink-0 px-4 pt-3 text-[11px] text-subtle">Click to add to the selected clip. Fine-tune it in the inspector.</p>
      <ul aria-label="Effects" className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto p-3">
        {EFFECTS.map((effect) => {
          const Glyph = EFFECT_ICONS[effect.kind];
          const on = applied.split(" ").includes(effect.kind);
          return (
            <li key={effect.kind}>
              <button
                type="button"
                onClick={() => addEffect(effect.kind)}
                className={`press relative flex w-full flex-col items-start gap-2 rounded-md bg-raised p-3 text-left hover:bg-raised-hover ${focusRing}`}
              >
                <Glyph size={20} className="text-accent" aria-hidden />
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">{effect.label}</span>
                  <span className="text-[11px] text-subtle">{effect.description}</span>
                </span>
                {on && <CheckIcon size={14} weight="bold" className="absolute right-2 top-2 text-accent" aria-label="Added" />}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Skin, sky, foliage and shadow: enough to show what a look does. */
const SWATCH: readonly (readonly [number, number, number])[] = [
  [0.86, 0.64, 0.52],
  [0.46, 0.66, 0.9],
  [0.36, 0.56, 0.3],
  [0.16, 0.14, 0.13],
];

function FilterList() {
  const assets = useEditor((s) => s.project.assets);
  const luts = Object.values(assets).filter((asset) => asset.kind === "lut");
  const inputId = useId();

  function onChosen(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) void importFiles(files);
  }

  return (
    <div className="min-h-0 overflow-y-auto">
      <ul aria-label="Filters" className="grid grid-cols-3 content-start gap-2 p-3">
        <li>
          <FilterTile label="None" adjust={NEUTRAL_ADJUSTMENTS} onClick={() => applyFilter(NEUTRAL_ADJUSTMENTS)} />
        </li>
        {FILTERS.map((filter) => (
          <li key={filter.id}>
            <FilterTile label={filter.label} adjust={{ ...NEUTRAL_ADJUSTMENTS, ...filter.adjust }} onClick={() => applyFilter(filter.adjust)} />
          </li>
        ))}
      </ul>

      <section aria-labelledby={`${inputId}-heading`} className="border-t border-border px-3 py-3">
        <div className="flex items-center justify-between">
          <h3 id={`${inputId}-heading`} className="text-xs font-semibold tracking-tight text-foreground">
            LUTs
          </h3>
          <input id={inputId} type="file" accept=".cube" multiple className="peer sr-only" onChange={onChosen} />
          <label
            htmlFor={inputId}
            className="press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-raised px-2.5 text-xs font-medium hover:bg-raised-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
          >
            <UploadSimpleIcon size={14} aria-hidden />
            Import LUT
          </label>
        </div>
        {luts.length === 0 ? (
          <p className="mt-2 text-[11px] text-subtle">Colour grades from Resolve, Premiere and LUT packs, as .cube files.</p>
        ) : (
          <ul aria-label="LUTs" className="mt-2 flex flex-col gap-1">
            {luts.map((lut) => (
              <li key={lut.id}>
                <button
                  type="button"
                  onClick={() => applyLut(lut.id)}
                  className={`press flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-raised hover:text-foreground ${focusRing}`}
                >
                  <PaletteIcon size={15} className="shrink-0 text-accent" aria-hidden />
                  <span className="truncate">{lut.name.replace(/\.cube$/i, "")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilterTile({ label, adjust, onClick }: { label: string; adjust: Adjustments; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`press group flex w-full min-w-0 flex-col gap-1.5 text-left ${focusRing} rounded-md`}>
      <span className="flex aspect-square overflow-hidden rounded-md ring-accent group-hover:ring-2" aria-hidden>
        {SWATCH.map((colour, i) => {
          const [r, g, b] = gradeColor(colour, adjust);
          return <span key={i} className="flex-1" style={{ background: `rgb(${r * 255} ${g * 255} ${b * 255})` }} />;
        })}
      </span>
      <span className="truncate text-xs text-muted group-hover:text-foreground">{label}</span>
    </button>
  );
}
