"use client";

import {
  type Adjustments,
  type BlendMode,
  type Clip,
  clipDuration,
  DEFAULT_CHROMA_KEY,
  DEFAULT_MASK,
  type EffectKind,
  followingClip,
  locateClip,
  type MaskShape,
  microsToSeconds,
  MIN_TRANSITION,
  NEUTRAL_ADJUSTMENTS,
  NO_ENHANCE,
  type Project,
  secondsToMicros,
  setTransition,
  updateClipLook,
} from "@akira/engine";
import { XIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { useTransitions } from "./effects-panel";
import { autoColor, EFFECTS, effectLabel } from "./look";
import { commit, endGesture, liveEdit, useEditor } from "./store";
import { Button, focusRing, IconButton, Section, Segmented, SelectField, SliderField, Toggle } from "./ui";

type Look = Parameters<typeof updateClipLook>[2];

function lookEditors(clip: Clip) {
  return {
    live: (change: Look) => liveEdit((p) => updateClipLook(p, clip.id, change)),
    set: (change: Look) => commit((p) => updateClipLook(p, clip.id, change)),
  };
}

const ADJUSTMENTS: readonly { key: keyof Adjustments; label: string }[] = [
  { key: "exposure", label: "Exposure" },
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "temperature", label: "Temperature" },
  { key: "tint", label: "Tint" },
  { key: "highlights", label: "Highlights" },
  { key: "shadows", label: "Shadows" },
  { key: "vignette", label: "Vignette" },
];

/** Adjustments, a LUT and chroma key. */
export function ColourTab({ project, clip }: { project: Project; clip: Clip }) {
  const { live, set } = lookEditors(clip);
  const adjust = clip.adjust ?? NEUTRAL_ADJUSTMENTS;
  const luts = Object.values(project.assets).filter((asset) => asset.kind === "lut");

  return (
    <>
      <Section title="Adjust">
        {ADJUSTMENTS.map(({ key, label }) => (
          <SliderField
            key={key}
            label={label}
            unit="%"
            value={adjust[key] * 100}
            min={key === "vignette" ? 0 : -100}
            max={100}
            step={1}
            onChange={(v) => live({ adjust: { [key]: v / 100 } })}
            onCommit={endGesture}
          />
        ))}
        <Button onClick={() => set({ adjust: NEUTRAL_ADJUSTMENTS })}>Reset adjustments</Button>
      </Section>

      <Section title="LUT">
        {luts.length === 0 ? (
          <p className="text-xs text-subtle">Import a .cube file from the Effects tab’s Filters to grade with it.</p>
        ) : (
          <SelectField
            label="Lookup table"
            value={clip.lut?.assetId ?? ""}
            options={[{ value: "", label: "None" }, ...luts.map((lut) => ({ value: lut.id, label: lut.name.replace(/\.cube$/i, "") }))]}
            onChange={(assetId) => set({ lut: assetId ? { assetId, intensity: clip.lut?.intensity ?? 1 } : null })}
          />
        )}
        {clip.lut && (
          <SliderField
            label="Intensity"
            unit="%"
            value={clip.lut.intensity * 100}
            min={0}
            max={100}
            step={1}
            onChange={(v) => live({ lut: { ...clip.lut!, intensity: v / 100 } })}
            onCommit={endGesture}
          />
        )}
      </Section>

      <ChromaKeySection clip={clip} />
    </>
  );
}

function ChromaKeySection({ clip }: { clip: Clip }) {
  const { live, set } = lookEditors(clip);
  const key = clip.chromaKey;
  const colorId = useId();

  return (
    <Section title="Chroma key">
      <Toggle
        label="Remove a colour"
        hint="Makes a green or blue screen see-through."
        checked={key !== undefined}
        onChange={(on) => set({ chromaKey: on ? DEFAULT_CHROMA_KEY : null })}
      />
      {key && (
        <>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={colorId} className="text-xs text-muted">
              Key colour
            </label>
            <div className="flex items-center gap-1">
              <Button onClick={() => set({ chromaKey: { color: "#00ff00" } })}>Green</Button>
              <Button onClick={() => set({ chromaKey: { color: "#0000ff" } })}>Blue</Button>
              <input
                id={colorId}
                type="color"
                value={key.color}
                onChange={(event) => live({ chromaKey: { color: event.target.value } })}
                onBlur={endGesture}
                className={`h-7 w-10 cursor-pointer rounded border border-border bg-raised ${focusRing}`}
              />
            </div>
          </div>
          <SliderField label="Tolerance" unit="%" value={key.tolerance * 100} min={0} max={100} step={1} onChange={(v) => live({ chromaKey: { tolerance: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Edge softness" unit="%" value={key.softness * 100} min={0} max={100} step={1} onChange={(v) => live({ chromaKey: { softness: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Remove spill" unit="%" value={key.spill * 100} min={0} max={100} step={1} onChange={(v) => live({ chromaKey: { spill: v / 100 } })} onCommit={endGesture} />
        </>
      )}
    </Section>
  );
}

const BLEND_MODES: readonly { value: BlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Colour dodge" },
  { value: "color-burn", label: "Colour burn" },
  { value: "hard-light", label: "Hard light" },
  { value: "soft-light", label: "Soft light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "add", label: "Add" },
];

const MASK_SHAPES: readonly { value: MaskShape | "none"; label: string }[] = [
  { value: "none", label: "None" },
  { value: "linear", label: "Linear" },
  { value: "mirror", label: "Mirror" },
  { value: "circle", label: "Circle" },
  { value: "rectangle", label: "Box" },
  { value: "heart", label: "Heart" },
  { value: "star", label: "Star" },
];

/** Effects, blend mode and mask. */
export function EffectsTab({ clip }: { clip: Clip }) {
  const { live, set } = lookEditors(clip);
  const effects = clip.effects ?? [];
  const missing = EFFECTS.filter((effect) => !effects.some((e) => e.kind === effect.kind));
  const mask = clip.mask;

  return (
    <>
      <Section title="Effects">
        {effects.length === 0 && <p className="text-xs text-subtle">No effects yet. Add one here or from the Effects tab.</p>}
        {effects.map((effect, index) => (
          <div key={effect.kind} className="flex items-end gap-1">
            <div className="min-w-0 flex-1">
              <SliderField
                label={effectLabel(effect.kind)}
                unit="%"
                value={effect.amount * 100}
                min={0}
                max={100}
                step={1}
                onChange={(v) => live({ effects: effects.map((e, i) => (i === index ? { ...e, amount: v / 100 } : e)) })}
                onCommit={endGesture}
              />
            </div>
            <IconButton icon={XIcon} label={`Remove ${effectLabel(effect.kind)}`} onClick={() => set({ effects: effects.filter((_, i) => i !== index) })} />
          </div>
        ))}
        {missing.length > 0 && (
          <SelectField<"" | EffectKind>
            label="Add effect"
            value=""
            options={[{ value: "", label: "Choose…" }, ...missing.map((effect) => ({ value: effect.kind, label: effect.label }))]}
            onChange={(kind) => kind && set({ effects: [...effects, { kind, amount: 0.5 }] })}
          />
        )}
      </Section>

      <Section title="Blend">
        <SelectField label="Blend mode" value={clip.blend ?? "normal"} options={BLEND_MODES} onChange={(blend) => set({ blend })} />
      </Section>

      <Section title="Mask">
        <Segmented
          label="Mask shape"
          value={mask?.shape ?? "none"}
          options={MASK_SHAPES}
          columns={4}
          onChange={(shape) => set({ mask: shape === "none" ? null : { ...DEFAULT_MASK, ...mask, shape } })}
        />
        {mask && (
          <>
            <SliderField label="Centre X" unit="%" value={mask.x * 100} min={-50} max={50} step={0.5} onChange={(v) => live({ mask: { x: v / 100 } })} onCommit={endGesture} />
            <SliderField label="Centre Y" unit="%" value={mask.y * 100} min={-50} max={50} step={0.5} onChange={(v) => live({ mask: { y: v / 100 } })} onCommit={endGesture} />
            {mask.shape !== "linear" && mask.shape !== "mirror" && (
              <SliderField label="Width" unit="%" value={mask.width * 100} min={1} max={300} step={1} onChange={(v) => live({ mask: { width: v / 100 } })} onCommit={endGesture} />
            )}
            {mask.shape !== "linear" && (
              <SliderField
                label={mask.shape === "mirror" ? "Band" : "Height"}
                unit="%"
                value={mask.height * 100}
                min={1}
                max={200}
                step={1}
                onChange={(v) => live({ mask: { height: v / 100 } })}
                onCommit={endGesture}
              />
            )}
            <SliderField label="Rotation" unit="°" value={mask.rotation} min={-180} max={180} step={1} onChange={(v) => live({ mask: { rotation: v } })} onCommit={endGesture} />
            <SliderField label="Feather" unit="%" value={mask.feather * 100} min={0} max={100} step={1} onChange={(v) => live({ mask: { feather: v / 100 } })} onCommit={endGesture} />
            <Toggle label="Invert" hint="Show what’s outside the shape instead." checked={mask.invert} onChange={(invert) => set({ mask: { invert } })} />
          </>
        )}
      </Section>
    </>
  );
}

/** Sharpening, clean-up, auto colour and FSR upscaling. */
export function EnhanceTab({ clip }: { clip: Clip }) {
  const { live, set } = lookEditors(clip);
  const enhance = clip.enhance ?? NO_ENHANCE;
  const hasThumbnails = useEditor((s) => (s.thumbnails.get(clip.assetId)?.length ?? 0) > 0);

  function oneTap() {
    set({ enhance: { sharpen: 0.35, denoise: 0.25, deband: 0.3, upscale: true } });
    if (hasThumbnails) autoColor(clip.id);
  }

  return (
    <>
      <Section title="Enhance">
        <p className="text-xs text-subtle">Classic filters that clean up and sharpen footage. Nothing is invented.</p>
        <Button variant="primary" onClick={oneTap}>
          Enhance in one tap
        </Button>
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-xs text-muted">Auto colour</span>
            <span className="text-[11px] text-subtle">{enhance.autoColor ? "On: black and white points set." : "Fixes dull or tinted footage."}</span>
          </span>
          {enhance.autoColor ? (
            <Button onClick={() => set({ enhance: { autoColor: null } })}>Remove</Button>
          ) : (
            <Button onClick={() => autoColor(clip.id)} disabled={!hasThumbnails}>
              Apply
            </Button>
          )}
        </div>
      </Section>

      <Section title="Detail">
        <SliderField label="Sharpen" unit="%" value={enhance.sharpen * 100} min={0} max={100} step={1} onChange={(v) => live({ enhance: { sharpen: v / 100 } })} onCommit={endGesture} />
        <SliderField label="Reduce noise" unit="%" value={enhance.denoise * 100} min={0} max={100} step={1} onChange={(v) => live({ enhance: { denoise: v / 100 } })} onCommit={endGesture} />
        <SliderField label="Smooth banding" unit="%" value={enhance.deband * 100} min={0} max={100} step={1} onChange={(v) => live({ enhance: { deband: v / 100 } })} onCommit={endGesture} />
        <SliderField label="Remove blockiness" unit="%" value={enhance.deblock * 100} min={0} max={100} step={1} onChange={(v) => live({ enhance: { deblock: v / 100 } })} onCommit={endGesture} />
        <Toggle
          label="Upscale with FSR"
          hint="Sharper edges when the clip is shown larger than its own resolution."
          checked={enhance.upscale}
          onChange={(upscale) => set({ enhance: { upscale } })}
        />
        <Button onClick={() => set({ enhance: NO_ENHANCE })}>Reset enhance</Button>
      </Section>
    </>
  );
}

/** The transition into the next clip, when one starts right where this one ends. */
export function TransitionSection({ project, clip }: { project: Project; clip: Clip }) {
  const transitions = useTransitions();
  const found = locateClip(project, clip.id);
  const next = found && followingClip(found.track, clip);
  if (!next) return null;

  const current = clip.transition;
  const longest = microsToSeconds(Math.min(clipDuration(clip), clipDuration(next)));
  const options = transitions?.map((t) => ({ value: t.name, label: t.label })) ?? (current ? [{ value: current.kind, label: current.kind }] : []);

  return (
    <Section title="Transition">
      <SelectField
        label="Into next clip"
        value={current?.kind ?? ""}
        options={[{ value: "", label: "None" }, ...options]}
        onChange={(kind) =>
          commit((p) => setTransition(p, clip.id, kind ? { kind, duration: current?.duration ?? secondsToMicros(Math.min(0.5, longest)) } : null))
        }
      />
      {current && (
        <SliderField
          label="Duration"
          unit="s"
          value={microsToSeconds(current.duration)}
          min={microsToSeconds(MIN_TRANSITION)}
          max={longest}
          step={0.05}
          onChange={(v) => liveEdit((p) => setTransition(p, clip.id, { ...current, duration: secondsToMicros(v) }))}
          onCommit={endGesture}
        />
      )}
    </Section>
  );
}
