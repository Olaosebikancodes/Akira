"use client";

import { frameToMicros, type Micros } from "@akira/engine";
import { type PointerEvent, useEffect, useRef } from "react";
import { useEditor } from "../store";
import { rulerStep, RULER_HEIGHT, timeToX } from "./layout";

/**
 * Time ruler with ticks, labels and markers. Only the visible stretch is
 * drawn, so it costs the same at any zoom or project length.
 */
export function Ruler({
  view,
  headerWidth,
  onPointerDown,
}: {
  view: { left: number; width: number };
  headerWidth: number;
  onPointerDown: (event: PointerEvent) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = useEditor((s) => s.zoom);
  const markers = useEditor((s) => s.project.markers);
  const frameRate = useEditor((s) => s.project.canvas.frameRate);

  useEffect(() => {
    const canvas = ref.current!;
    const ratio = devicePixelRatio;
    const width = Math.max(1, view.width);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(RULER_HEIGHT * ratio);
    const context = canvas.getContext("2d")!;
    context.scale(ratio, ratio);

    const styles = getComputedStyle(document.documentElement);
    const tick = styles.getPropertyValue("--subtle");
    const label = styles.getPropertyValue("--muted");
    const accent = styles.getPropertyValue("--accent");

    const frame = frameToMicros(1, frameRate);
    const { major, minor } = rulerStep(zoom, frame);
    const from = Math.floor((view.left / zoom) * 1_000_000 / minor) * minor;
    const to = ((view.left + width) / zoom) * 1_000_000;

    context.font = `10px ${styles.getPropertyValue("--font-geist-mono") || "monospace"}`;
    context.textBaseline = "top";
    for (let time: Micros = from; time <= to; time += minor) {
      const x = Math.round(timeToX(time, zoom) - view.left) + 0.5;
      const isMajor = Math.round(time / minor) % Math.round(major / minor) === 0;
      context.fillStyle = tick;
      context.fillRect(x, isMajor ? RULER_HEIGHT - 10 : RULER_HEIGHT - 5, 1, isMajor ? 10 : 5);
      if (isMajor) {
        context.fillStyle = label;
        context.fillText(formatRulerTime(time, frame, major < 1_000_000), x + 4, 6);
      }
    }

    context.fillStyle = accent;
    for (const marker of markers) {
      const x = timeToX(marker.time, zoom) - view.left;
      if (x < -6 || x > width + 6) continue;
      context.beginPath();
      context.moveTo(x - 4, 1);
      context.lineTo(x + 4, 1);
      context.lineTo(x, 7);
      context.closePath();
      context.fill();
    }
  }, [view, zoom, markers, frameRate]);

  return (
    <div className="sticky shrink-0 cursor-text touch-none" style={{ left: headerWidth, width: view.width }} onPointerDown={onPointerDown}>
      <canvas ref={ref} aria-hidden className="block h-full w-full" style={{ height: RULER_HEIGHT }} />
    </div>
  );
}

/** "1:05" for whole seconds, "1:05:12" (frames) when zoomed in past a second per label. */
function formatRulerTime(time: Micros, frame: Micros, withFrames: boolean): string {
  const totalSeconds = Math.floor(time / 1_000_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  if (!withFrames) return `${minutes}:${seconds}`;
  const frames = String(Math.round((time % 1_000_000) / frame)).padStart(2, "0");
  return `${minutes}:${seconds}:${frames}`;
}
