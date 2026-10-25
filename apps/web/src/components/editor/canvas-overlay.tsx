"use client";

import { type Clip, type Point, pointInQuad, setValuesAt, transformAt } from "@akira/engine";
import { type PointerEvent, useState } from "react";
import { visibleLayers } from "./layers";
import { beginGesture, endGesture, requestTextFocus, select, updateGesture, useEditor } from "./store";

/** Within this fraction of the canvas, a dragged clip snaps to the centre lines. */
const CENTRE_SNAP = 0.012;
const ROTATION_SNAP_DEGREES = 4;

type Drag =
  | { kind: "move"; clip: Clip; from: Point }
  | { kind: "scale"; clip: Clip; centre: Point; from: Point }
  | { kind: "rotate"; clip: Clip; centre: Point; from: Point };

/**
 * Selection outline and handles drawn over the preview. The SVG's viewBox is
 * the canvas in pixels, so the engine's layer corners line up exactly with
 * what the compositor draws. `scale` is display pixels per canvas pixel and
 * keeps handles the same size on screen whatever the project resolution.
 */
export function CanvasOverlay({ scale }: { scale: number }) {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const selection = useEditor((s) => s.selection);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });

  const { width, height } = project.canvas;
  const layers = visibleLayers(project, time);
  const selected = layers.findLast((layer) => selection.includes(layer.clip.id));
  const corners = selected?.geometry.corners;
  const centre: Point | null = corners
    ? [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2]
    : null;
  const handle = 6 / scale;
  const rotateHandle = corners && rotationHandlePoint(corners, 24 / scale);

  function toCanvas(event: PointerEvent<SVGSVGElement>): Point {
    const box = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * width, ((event.clientY - box.top) / box.height) * height];
  }

  function start(event: PointerEvent<SVGSVGElement>, next: Drag) {
    event.currentTarget.setPointerCapture(event.pointerId);
    beginGesture();
    setDrag(next);
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const point = toCanvas(event);
    const target = (event.target as Element).getAttribute("data-handle");
    if (selected && centre && target === "scale") return start(event, { kind: "scale", clip: selected.clip, centre, from: point });
    if (selected && centre && target === "rotate") return start(event, { kind: "rotate", clip: selected.clip, centre, from: point });

    const hit = layers.findLast((layer) => pointInQuad(point, layer.geometry.corners));
    if (!hit) return select([]);
    if (!selection.includes(hit.clip.id)) select([hit.clip.id]);
    start(event, { kind: "move", clip: hit.clip, from: point });
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const point = toCanvas(event);
    const { clip } = drag;
    // Drag from the values at the playhead; keyframed ones get a keyframe there.
    const base = transformAt(clip, time);

    if (drag.kind === "move") {
      let x = base.x + (point[0] - drag.from[0]) / width;
      let y = base.y + (point[1] - drag.from[1]) / height;
      const snapX = Math.abs(x) < CENTRE_SNAP;
      const snapY = Math.abs(y) < CENTRE_SNAP;
      if (snapX) x = 0;
      if (snapY) y = 0;
      setGuides({ x: snapX, y: snapY });
      updateGesture((project) => setValuesAt(project, clip.id, time, { x, y }));
    } else if (drag.kind === "scale") {
      const ratio = distance(point, drag.centre) / Math.max(1, distance(drag.from, drag.centre));
      const scaleValue = Math.min(20, Math.max(0.02, base.scale * ratio));
      updateGesture((project) => setValuesAt(project, clip.id, time, { scale: scaleValue }));
    } else {
      const turned = angle(drag.centre, point) - angle(drag.centre, drag.from);
      let rotation = normalise(base.rotation + turned);
      const step = event.shiftKey ? 15 : 90;
      const nearest = Math.round(rotation / step) * step;
      if (event.shiftKey || Math.abs(rotation - nearest) < ROTATION_SNAP_DEGREES) rotation = normalise(nearest);
      updateGesture((project) => setValuesAt(project, clip.id, time, { rotation }));
    }
  }

  function onPointerUp() {
    if (!drag) return;
    endGesture();
    setDrag(null);
    setGuides({ x: false, y: false });
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      // Handles may reach past the canvas edge, into the space around it.
      overflow="visible"
      className="absolute inset-0 size-full touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        // Double-clicking text jumps to editing its words, as in most editors.
        if (selected?.clip.text) requestTextFocus();
      }}
      aria-hidden
    >
      {guides.x && <line x1={width / 2} y1={0} x2={width / 2} y2={height} className="stroke-accent" strokeWidth={1 / scale} />}
      {guides.y && <line x1={0} y1={height / 2} x2={width} y2={height / 2} className="stroke-accent" strokeWidth={1 / scale} />}
      {corners && rotateHandle && (
        <g>
          <polygon
            points={corners.map((p) => p.join(",")).join(" ")}
            fill="none"
            className="stroke-[var(--clip-selected)]"
            strokeWidth={1.5 / scale}
          />
          <line
            x1={(corners[2][0] + corners[3][0]) / 2}
            y1={(corners[2][1] + corners[3][1]) / 2}
            x2={rotateHandle[0]}
            y2={rotateHandle[1]}
            className="stroke-[var(--clip-selected)]"
            strokeWidth={1 / scale}
          />
          <circle
            data-handle="rotate"
            cx={rotateHandle[0]}
            cy={rotateHandle[1]}
            r={handle}
            className="cursor-grab fill-[var(--stage)] stroke-[var(--clip-selected)]"
            strokeWidth={1.5 / scale}
          />
          {corners.map((corner, index) => (
            <rect
              key={index}
              data-handle="scale"
              x={corner[0] - handle}
              y={corner[1] - handle}
              width={handle * 2}
              height={handle * 2}
              rx={1.5 / scale}
              className="cursor-nwse-resize fill-[var(--clip-selected)]"
            />
          ))}
        </g>
      )}
    </svg>
  );
}

/**
 * A point just past the bottom edge's midpoint, perpendicular to it, for the
 * rotation handle, as in CapCut. The preview leaves room around the canvas so
 * it stays visible on full-frame clips.
 */
function rotationHandlePoint(corners: readonly Point[], offset: number): Point {
  const [a, , c, d] = corners as [Point, Point, Point, Point];
  const mid: Point = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
  const downX = d[0] - a[0];
  const downY = d[1] - a[1];
  const length = Math.hypot(downX, downY) || 1;
  return [mid[0] + (downX / length) * offset, mid[1] + (downY / length) * offset];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function angle(centre: Point, point: Point): number {
  return (Math.atan2(point[1] - centre[1], point[0] - centre[0]) * 180) / Math.PI;
}

function normalise(degrees: number): number {
  const turned = ((degrees % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
}
