"use client";

import {
  ASPECT_PRESETS,
  assetOf,
  type Background,
  type Clip,
  currentAspect,
  FPS_23_976,
  FPS_24,
  FPS_25,
  FPS_29_97,
  FPS_30,
  FPS_50,
  FPS_59_94,
  FPS_60,
  flipClip,
  IDENTITY_TRANSFORM,
  isStill,
  locateClip,
  MAX_SPEED,
  MIN_SPEED,
  NO_CROP,
  type Project,
  rotateClip90,
  setAspect,
  setAudioFilters,
  setClipFades,
  setClipSpeed,
  clipDuration,
  microsToSeconds,
  secondsToMicros,
  updateClipLook,
} from "@akira/engine";
import { ArrowClockwiseIcon, FlipHorizontalIcon, FlipVerticalIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { AnimationSection, TextSections } from "./inspector-text";
import { commit, endGesture, liveEdit, useEditor } from "./store";
import { Button, focusRing, IconButton, Section, Segmented, SliderField } from "./ui";

const FRAME_RATES = [
  { label: "23.976", rate: FPS_23_976 },
  { label: "24", rate: FPS_24 },
  { label: "25", rate: FPS_25 },
  { label: "29.97", rate: FPS_29_97 },
  { label: "30", rate: FPS_30 },
  { label: "50", rate: FPS_50 },
  { label: "59.94", rate: FPS_59_94 },
  { label: "60", rate: FPS_60 },
];

const live = liveEdit;

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const found = selection.length === 1 ? locateClip(project, selection[0]!) : undefined;

  return (
    <aside aria-label="Inspector" className="flex min-h-0 flex-col overflow-y-auto bg-panel">
      <header className="flex h-11 shrink-0 items-center border-b border-border px-4">
        <h2 className="truncate text-[13px] font-semibold tracking-tight">
          {found ? (found.clip.text ? "Text" : assetOf(project, found.clip).name) : selection.length > 1 ? `${selection.length} clips` : "Project"}
        </h2>
      </header>
      {found ? (
        <ClipInspector project={project} clip={found.clip} isVisual={found.track.kind === "video"} locked={found.track.locked} />
      ) : selection.length > 1 ? (
        <p className="px-4 py-4 text-xs text-muted">
          Delete, duplicate or split them together from the timeline toolbar.
        </p>
      ) : (
        <ProjectInspector project={project} />
      )}
    </aside>
  );
}

function ClipInspector({ project, clip, isVisual, locked }: { project: Project; clip: Clip; isVisual: boolean; locked: boolean }) {
  const asset = assetOf(project, clip);
  const still = isStill(project, clip);
  const { transform, crop } = clip;
  const look = (change: Parameters<typeof updateClipLook>[2]) => live((p) => updateClipLook(p, clip.id, change));

  if (locked) {
    return <p className="px-4 py-4 text-xs text-muted">This clip is on a locked track. Unlock the track to edit it.</p>;
  }

  return (
    <div>
      {clip.text && <TextSections clip={clip} />}

      {isVisual && (
        <Section
          title="Transform"
          action={
            <div className="flex">
              <IconButton icon={ArrowClockwiseIcon} label="Rotate 90°" onClick={() => commit((p) => rotateClip90(p, clip.id))} />
              <IconButton icon={FlipHorizontalIcon} label="Flip horizontally" onClick={() => commit((p) => flipClip(p, clip.id, "x"))} active={transform.flipX} />
              <IconButton icon={FlipVerticalIcon} label="Flip vertically" onClick={() => commit((p) => flipClip(p, clip.id, "y"))} active={transform.flipY} />
            </div>
          }
        >
          <SliderField label="Position X" unit="%" value={transform.x * 100} min={-100} max={100} step={0.5} onChange={(v) => look({ transform: { x: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Position Y" unit="%" value={transform.y * 100} min={-100} max={100} step={0.5} onChange={(v) => look({ transform: { y: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Scale" unit="%" value={transform.scale * 100} min={5} max={400} step={1} onChange={(v) => look({ transform: { scale: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Rotation" unit="°" value={transform.rotation} min={-180} max={180} step={1} onChange={(v) => look({ transform: { rotation: v } })} onCommit={endGesture} />
          <SliderField label="Opacity" unit="%" value={transform.opacity * 100} min={0} max={100} step={1} onChange={(v) => look({ transform: { opacity: v / 100 } })} onCommit={endGesture} />
          <Button onClick={() => commit((p) => updateClipLook(p, clip.id, { transform: IDENTITY_TRANSFORM }))}>Reset transform</Button>
        </Section>
      )}

      {isVisual && !clip.text && (
        <Section title="Crop">
          <SliderField label="Left" unit="%" value={crop.left * 100} min={0} max={95} step={0.5} onChange={(v) => look({ crop: { left: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Right" unit="%" value={crop.right * 100} min={0} max={95} step={0.5} onChange={(v) => look({ crop: { right: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Top" unit="%" value={crop.top * 100} min={0} max={95} step={0.5} onChange={(v) => look({ crop: { top: v / 100 } })} onCommit={endGesture} />
          <SliderField label="Bottom" unit="%" value={crop.bottom * 100} min={0} max={95} step={0.5} onChange={(v) => look({ crop: { bottom: v / 100 } })} onCommit={endGesture} />
          <Button onClick={() => commit((p) => updateClipLook(p, clip.id, { crop: NO_CROP }))}>Reset crop</Button>
        </Section>
      )}

      {isVisual && <AnimationSection clip={clip} />}

      {!still && (
        <Section title="Speed">
          <SliderField
            label="Speed"
            unit="×"
            value={clip.speed}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.05}
            onChange={(v) => live((p) => setClipSpeed(p, clip.id, v))}
            onCommit={endGesture}
          />
          <Segmented
            label="Speed presets"
            value={String(clip.speed)}
            options={["0.5", "1", "1.5", "2"].map((v) => ({ value: v, label: `${v}×` }))}
            onChange={(v) => commit((p) => setClipSpeed(p, clip.id, Number(v)))}
          />
        </Section>
      )}

      {!still && asset.audio && <AudioSection clip={clip} />}
    </div>
  );
}

function AudioSection({ clip }: { clip: Clip }) {
  const longest = Math.min(10, microsToSeconds(clipDuration(clip)));
  const { denoise, hum, rumble } = clip.audioFilters;
  const rumbleId = useId();

  return (
    <>
      <Section title="Audio">
        <SliderField
          label="Volume"
          unit="%"
          value={clip.volume * 100}
          min={0}
          max={200}
          step={1}
          onChange={(v) => live((p) => updateClipLook(p, clip.id, { volume: v / 100 }))}
          onCommit={endGesture}
        />
        <SliderField
          label="Fade in"
          unit="s"
          value={microsToSeconds(clip.fadeIn)}
          min={0}
          max={longest}
          step={0.1}
          onChange={(v) => live((p) => setClipFades(p, clip.id, { fadeIn: secondsToMicros(v) }))}
          onCommit={endGesture}
        />
        <SliderField
          label="Fade out"
          unit="s"
          value={microsToSeconds(clip.fadeOut)}
          min={0}
          max={longest}
          step={0.1}
          onChange={(v) => live((p) => setClipFades(p, clip.id, { fadeOut: secondsToMicros(v) }))}
          onCommit={endGesture}
        />
      </Section>

      <Section title="Clean up">
        <SliderField
          label="Reduce hiss"
          unit="%"
          value={denoise * 100}
          min={0}
          max={100}
          step={5}
          onChange={(v) => live((p) => setAudioFilters(p, clip.id, { denoise: v / 100 }))}
          onCommit={endGesture}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Remove hum</span>
          <Segmented
            label="Remove hum"
            value={String(hum)}
            options={[
              { value: "0", label: "Off" },
              { value: "50", label: "50 Hz" },
              { value: "60", label: "60 Hz" },
            ]}
            onChange={(v) => commit((p) => setAudioFilters(p, clip.id, { hum: Number(v) as 0 | 50 | 60 }))}
          />
          <p className="text-[11px] text-subtle">Electrical buzz. Nigeria and Europe use 50 Hz, the Americas 60 Hz.</p>
        </div>
        <label htmlFor={rumbleId} className="flex cursor-pointer items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-xs text-muted">Cut rumble</span>
            <span className="text-[11px] text-subtle">Wind, traffic and handling noise.</span>
          </span>
          <input
            id={rumbleId}
            type="checkbox"
            checked={rumble}
            onChange={(event) => commit((p) => setAudioFilters(p, clip.id, { rumble: event.target.checked }))}
            className={`size-4 cursor-pointer accent-accent ${focusRing}`}
          />
        </label>
      </Section>
    </>
  );
}

function ProjectInspector({ project }: { project: Project }) {
  const aspect = currentAspect(project);
  const { background, frameRate, width, height } = project.canvas;
  const images = Object.values(project.assets).filter((asset) => asset.kind === "image");
  const rateId = useId();
  const imageId = useId();
  const colorId = useId();
  const setBackground = (next: Background) => commit((p) => ({ ...p, canvas: { ...p.canvas, background: next } }));

  return (
    <div>
      <Section title="Aspect ratio">
        <Segmented
          label="Aspect ratio"
          value={aspect}
          options={ASPECT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          columns={4}
          onChange={(id) => commit((p) => setAspect(p, id))}
        />
        <p className="font-mono text-xs tabular-nums text-subtle">
          {width} × {height}
        </p>
      </Section>

      <Section title="Background">
        <Segmented
          label="Background"
          value={background.kind}
          options={[
            { value: "color", label: "Colour" },
            { value: "blur", label: "Blur" },
            { value: "image", label: "Image" },
          ]}
          onChange={(kind) => {
            if (kind === "color") setBackground({ kind, color: "#000000" });
            else if (kind === "blur") setBackground({ kind, amount: 0.5 });
            else if (images[0]) setBackground({ kind, assetId: images[0].id });
          }}
        />
        {background.kind === "color" && (
          <div className="flex items-center justify-between">
            <label htmlFor={colorId} className="text-xs text-muted">
              Colour
            </label>
            <input
              id={colorId}
              type="color"
              value={background.color}
              onChange={(event) => live((p) => ({ ...p, canvas: { ...p.canvas, background: { kind: "color", color: event.target.value } } }))}
              onBlur={endGesture}
              className={`h-7 w-12 cursor-pointer rounded border border-border bg-raised ${focusRing}`}
            />
          </div>
        )}
        {background.kind === "blur" && (
          <SliderField
            label="Blur"
            unit="%"
            value={background.amount * 100}
            min={0}
            max={100}
            step={1}
            onChange={(v) => live((p) => ({ ...p, canvas: { ...p.canvas, background: { kind: "blur", amount: v / 100 } } }))}
            onCommit={endGesture}
          />
        )}
        {background.kind === "image" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={imageId} className="text-xs text-muted">
              Image
            </label>
            <select
              id={imageId}
              value={background.assetId}
              onChange={(event) => setBackground({ kind: "image", assetId: event.target.value })}
              className={`h-8 rounded-md border border-border bg-raised px-2 text-xs text-foreground ${focusRing}`}
            >
              {images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {background.kind !== "image" && images.length === 0 && (
          <p className="text-xs text-subtle">Import an image to use it as the background.</p>
        )}
      </Section>

      <Section title="Frame rate">
        <label htmlFor={rateId} className="sr-only">
          Frame rate
        </label>
        <select
          id={rateId}
          value={FRAME_RATES.find((r) => r.rate.num === frameRate.num && r.rate.den === frameRate.den)?.label ?? "30"}
          onChange={(event) => {
            const rate = FRAME_RATES.find((r) => r.label === event.target.value)!.rate;
            commit((p) => ({ ...p, canvas: { ...p.canvas, frameRate: rate } }));
          }}
          className={`h-8 rounded-md border border-border bg-raised px-2 text-xs text-foreground ${focusRing}`}
        >
          {FRAME_RATES.map((r) => (
            <option key={r.label} value={r.label}>
              {r.label} fps
            </option>
          ))}
        </select>
      </Section>
    </div>
  );
}
