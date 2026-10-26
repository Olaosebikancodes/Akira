"use client";

import {
  applySpeedPreset,
  type Clip,
  clipContains,
  clipDuration,
  curveSpeed,
  MAX_CURVE_SPEED,
  MAX_SPEED,
  MIN_CURVE_SPEED,
  MIN_SPEED,
  microsToSeconds,
  type Micros,
  setClipSpeed,
  setFrameBlending,
  setSpeedCurve,
  SPEED_PRESETS,
  type SpeedPoint,
  type SpeedPreset,
  toSourceTime,
} from "@akira/engine";
import { type KeyboardEvent, type MouseEvent, type PointerEvent, useRef, useState } from "react";
import { toggleReverse } from "./jobs";
import { beginGesture, commit, endGesture, liveEdit, updateGesture, useEditingTime, useEditor } from "./store";
import { Button, focusRing, Section, Segmented, SliderField, Toggle } from "./ui";

const GRAPH_WIDTH = 256;
const GRAPH_HEIGHT = 120;
/** Points this close (as a fraction of the clip) are too close to tell apart. */
const MIN_GAP = 0.02;

/** Constant speed or a curve, plus frame blending for slow motion. */
export function SpeedSection({ clip }: { clip: Clip }) {
  const mode = clip.speedCurve ? "curve" : "normal";
  return (
    <Section title="Speed">
      <Segmented
        label="Speed mode"
        value={mode}
        options={[
          { value: "normal", label: "Normal" },
          { value: "curve", label: "Curve" },
        ]}
        onChange={(next) => {
          if (next === "normal") commit((p) => setClipSpeed(p, clip.id, clip.speedCurve ? 1 : clip.speed));
          else commit((p) => setSpeedCurve(p, clip.id, flatCurve(clip)));
        }}
      />
      {mode === "normal" ? (
        <>
          <SliderField
            label="Speed"
            unit="×"
            value={clip.speed}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.05}
            onChange={(v) => liveEdit((p) => setClipSpeed(p, clip.id, v))}
            onCommit={endGesture}
          />
          <Segmented
            label="Speed presets"
            value={String(clip.speed)}
            options={["0.5", "1", "1.5", "2"].map((v) => ({ value: v, label: `${v}×` }))}
            onChange={(v) => commit((p) => setClipSpeed(p, clip.id, Number(v)))}
          />
        </>
      ) : (
        <CurveEditor clip={clip} />
      )}
      <ReverseButton clip={clip} />
      <Toggle
        label="Smooth slow motion"
        hint="Blends neighbouring frames wherever the clip plays slower than it was filmed."
        checked={clip.frameBlending === true}
        onChange={(on) => commit((p) => setFrameBlending(p, clip.id, on))}
      />
    </Section>
  );
}

/** Plays the clip backwards, making a reversed copy of its footage in the background the first time. */
function ReverseButton({ clip }: { clip: Clip }) {
  const reversed = useEditor((s) => s.project.assets[clip.assetId]?.reverseOf !== undefined);
  const busy = useEditor((s) => s.jobs.some((job) => job.clipId === clip.id));
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-xs text-muted">Reverse</span>
        <span className="text-[11px] text-subtle">{busy ? "Reversing in the background…" : reversed ? "Playing backwards." : "Play the clip backwards."}</span>
      </span>
      <Button onClick={() => void toggleReverse()} disabled={busy}>
        {reversed ? "Play forwards" : "Reverse"}
      </Button>
    </div>
  );
}

/** Three points at the clip's current speed: a flat line ready to be shaped. */
function flatCurve(clip: Clip): SpeedPoint[] {
  const length = clip.sourceOut - clip.sourceIn;
  return [0, 0.5, 1].map((at) => ({ time: Math.round(clip.sourceIn + at * length), speed: clip.speed }));
}

function CurveEditor({ clip }: { clip: Clip }) {
  const curve = clip.speedCurve!;
  const time = useEditingTime();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ index: number; start: SpeedPoint[] } | null>(null);
  const length = clip.sourceOut - clip.sourceIn;
  const toX = (t: Micros) => ((t - clip.sourceIn) / length) * GRAPH_WIDTH;
  const toY = (speed: number) => GRAPH_HEIGHT / 2 - (Math.log10(speed) * GRAPH_HEIGHT) / 2;
  const fromY = (y: number) => clampSpeed(10 ** ((GRAPH_HEIGHT / 2 - y) / (GRAPH_HEIGHT / 2)));
  const playhead = clipContains(clip, time) ? toX(toSourceTime(clip, time)) : null;

  function graphPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * GRAPH_WIDTH, y: ((event.clientY - box.top) / box.height) * GRAPH_HEIGHT };
  }

  function update(points: SpeedPoint[], live = false) {
    if (live) updateGesture((p) => setSpeedCurve(p, clip.id, points));
    else commit((p) => setSpeedCurve(p, clip.id, points));
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    const { x, y } = graphPoint(event);
    const points = dragging.start;
    const i = dragging.index;
    // Points move between their neighbours; the first and last stay at the clip's ends.
    const low = i === 0 ? 0 : (points[i - 1]!.time - clip.sourceIn) / length + MIN_GAP;
    const high = i === points.length - 1 ? 1 : (points[i + 1]!.time - clip.sourceIn) / length - MIN_GAP;
    const at = i === 0 || i === points.length - 1 ? (points[i]!.time - clip.sourceIn) / length : clamp(x / GRAPH_WIDTH, low, high);
    const moved = points.map((p, j) => (j === i ? { time: Math.round(clip.sourceIn + at * length), speed: fromY(y) } : p));
    update(moved, true);
  }

  function addAt(at: number, speed: number) {
    const time = Math.round(clip.sourceIn + clamp(at, 0, 1) * length);
    if (curve.some((p) => Math.abs(p.time - time) < MIN_GAP * length)) return;
    update([...curve, { time, speed: clampSpeed(speed) }]);
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const point = curve[index]!;
    let speed = point.speed;
    if (event.key === "ArrowUp") speed *= 1.1;
    else if (event.key === "ArrowDown") speed /= 1.1;
    else if ((event.key === "Delete" || event.key === "Backspace") && curve.length > 2) {
      event.preventDefault();
      event.stopPropagation();
      update(curve.filter((_, j) => j !== index));
      return;
    } else return;
    // Arrows here change speed, not the playhead.
    event.preventDefault();
    event.stopPropagation();
    update(curve.map((p, j) => (j === index ? { ...p, speed: clampSpeed(speed) } : p)));
  }

  const path = curvePath((t) => curveSpeed(curve, clip.sourceIn + t * length), toY);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1">
        {SPEED_PRESETS.map((preset) => (
          <PresetButton key={preset.id} preset={preset} onClick={() => commit((p) => applySpeedPreset(p, clip.id, preset.id))} />
        ))}
      </div>
      <svg
        ref={svgRef}
        role="group"
        aria-label="Speed curve. Drag points to change speed; double-click to add one."
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        className="h-[120px] w-full touch-none select-none rounded-md bg-raised"
        preserveAspectRatio="none"
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          if (!dragging) return;
          endGesture();
          setDragging(null);
        }}
        onDoubleClick={(event) => {
          const { x, y } = graphPoint(event);
          addAt(x / GRAPH_WIDTH, fromY(y));
        }}
      >
        {[10, 1, 0.1].map((speed) => (
          <line key={speed} x1={0} x2={GRAPH_WIDTH} y1={toY(speed)} y2={toY(speed)} className="stroke-border" strokeDasharray={speed === 1 ? undefined : "2 3"} />
        ))}
        {playhead !== null && <line x1={playhead} x2={playhead} y1={0} y2={GRAPH_HEIGHT} className="stroke-danger" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        <path d={path} fill="none" className="stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {curve.map((point, index) => (
          <circle
            key={index}
            role="slider"
            tabIndex={0}
            aria-label={`Speed point ${index + 1} of ${curve.length}`}
            aria-valuemin={MIN_CURVE_SPEED}
            aria-valuemax={MAX_CURVE_SPEED}
            aria-valuenow={Number(point.speed.toFixed(2))}
            aria-valuetext={`${point.speed.toFixed(2)}×`}
            cx={toX(point.time)}
            cy={toY(point.speed)}
            r={5}
            className="cursor-grab fill-foreground stroke-accent outline-none focus-visible:fill-accent"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(event) => {
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              beginGesture();
              setDragging({ index, start: curve });
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (curve.length > 2 && index > 0 && index < curve.length - 1) update(curve.filter((_, j) => j !== index));
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        ))}
      </svg>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs tabular-nums text-subtle">{microsToSeconds(clipDuration(clip)).toFixed(2)} s long</span>
        <div className="flex gap-1">
          <Button
            onClick={() => playhead !== null && addAt(playhead / GRAPH_WIDTH, curveSpeed(curve, toSourceTime(clip, time)))}
            disabled={playhead === null}
          >
            Add point
          </Button>
          <Button onClick={() => update(flatCurve({ ...clip, speed: 1 }))}>Reset</Button>
        </div>
      </div>
    </div>
  );
}

/** A preset as a tiny drawing of its curve, so the shape says what it does. */
function PresetButton({ preset, onClick }: { preset: SpeedPreset; onClick: () => void }) {
  const points = preset.points.map(({ at, speed }) => ({ time: at * 1_000_000, speed }));
  const toY = (speed: number) => 14 - Math.log10(speed) * 12;
  return (
    <button
      type="button"
      onClick={onClick}
      title={preset.label}
      className={`press flex min-w-0 flex-col items-center gap-0.5 rounded-md bg-raised px-1 py-1.5 hover:bg-raised-hover ${focusRing}`}
    >
      <svg viewBox="0 0 48 28" className="h-6 w-full" aria-hidden preserveAspectRatio="none">
        <path d={curvePath((t) => curveSpeed(points, t * 1_000_000), toY, 48)} fill="none" className="stroke-accent" strokeWidth={1.5} />
      </svg>
      <span className="w-full truncate text-center text-[10px] text-muted">{preset.label}</span>
    </button>
  );
}

/** Samples `speedAt` across 0 to 1 into an SVG path. */
function curvePath(speedAt: (t: number) => number, toY: (speed: number) => number, width = GRAPH_WIDTH): string {
  const steps = 64;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return `${i === 0 ? "M" : "L"}${(t * width).toFixed(2)},${toY(speedAt(t)).toFixed(2)}`;
  }).join(" ");
}

function clampSpeed(speed: number): number {
  return clamp(speed, MIN_CURVE_SPEED, MAX_CURVE_SPEED);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
