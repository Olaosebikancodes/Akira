"use client";

import { type PointerEvent, useEffect, useState } from "react";
import { trackBox } from "./jobs";
import { setTrackingSetup, useEditor } from "./store";

/** Boxes smaller than this, in canvas pixels, are taken as a slip of the mouse. */
const MIN_BOX = 8;

/**
 * Replaces the selection handles while tracking is being set up: drag a box
 * around what the clip should follow. Escape cancels.
 */
export function TrackingOverlay() {
  const { width, height } = useEditor((s) => s.project.canvas);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setTrackingSetup(null);
    }
    // Capture, so the editor's own Escape (clear selection) doesn't also run.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  function toCanvas(event: PointerEvent<SVGSVGElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * width, ((event.clientY - box.top) / box.height) * height];
  }

  const box = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="application"
        aria-label="Drag a box around what the clip should follow"
        className="absolute inset-0 size-full cursor-crosshair touch-none select-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const [x, y] = toCanvas(event);
          setDrag({ x0: x, y0: y, x1: x, y1: y });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const [x, y] = toCanvas(event);
          setDrag({ ...drag, x1: x, y1: y });
        }}
        onPointerUp={() => {
          if (box && box.width >= MIN_BOX && box.height >= MIN_BOX) void trackBox(box);
          setDrag(null);
        }}
      >
        <rect width={width} height={height} className="fill-black/30" />
        {box && (
          <rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            className="fill-white/10 stroke-accent"
            strokeWidth={2}
            strokeDasharray="8 6"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-md bg-black/75 px-3 py-1.5 text-xs text-foreground">
        Drag a box around what the clip should follow. Esc cancels.
      </p>
    </>
  );
}
