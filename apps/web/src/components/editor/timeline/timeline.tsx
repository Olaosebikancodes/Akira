"use client";

import {
  clipDuration,
  clipEnd,
  type Edge,
  type Id,
  type Micros,
  moveClip,
  type Placement,
  projectDuration,
  snapRange,
  snapTargets,
  snapTime,
  trimClip,
} from "@akira/engine";
import { type DragEvent, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { addToTimeline } from "../actions";
import { ASSET_DRAG_TYPE } from "../media-panel";
import { beginGesture, endGesture, seek, select, setZoom, updateGesture, useEditor } from "../store";
import { ClipItem } from "./clip-item";
import {
  HEADER_WIDTH,
  RULER_HEIGHT,
  type RowBox,
  rowAt,
  SNAP_PIXELS,
  TAIL_SECONDS,
  timelineRows,
  timeToX,
  xToTime,
} from "./layout";
import { Ruler } from "./ruler";
import { TimelineToolbar } from "./toolbar";
import { TrackHeader } from "./track-header";

type Drag =
  | {
      kind: "pending" | "move";
      clipId: Id;
      fromX: number;
      fromY: number;
      fromTime: Micros;
      clipStart: Micros;
      length: Micros;
      boxes: RowBox[];
      targets: Micros[];
    }
  | { kind: "trim"; clipId: Id; edge: Edge; edgeTime: Micros; fromTime: Micros; targets: Micros[] }
  | { kind: "seek" };

/** Pixels the pointer must travel before a press on a clip becomes a drag. */
const DRAG_THRESHOLD = 4;

export function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<Id, HTMLDivElement>());
  const dragRef = useRef<Drag | null>(null);
  const [guide, setGuide] = useState<Micros | null>(null);
  const [view, setView] = useState({ left: 0, width: 0 });

  const rows = timelineRows(project);
  const contentWidth = Math.max(timeToX(projectDuration(project), zoom) + TAIL_SECONDS * zoom, view.width);
  const empty = rows.every((row) => row.track.clips.length === 0);

  useEffect(() => {
    const element = scrollRef.current!;
    const measure = () => setView({ left: element.scrollLeft, width: element.clientWidth - HEADER_WIDTH });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Ctrl/Cmd + wheel zooms around the pointer; it needs a non-passive listener to stop page zoom.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const { zoom: current } = useEditor.getState();
      const pointer = event.clientX - element.getBoundingClientRect().left - HEADER_WIDTH;
      const time = xToTime(element.scrollLeft + pointer, current);
      const next = current * Math.exp(-event.deltaY * 0.0025);
      setZoom(next);
      element.scrollLeft = timeToX(time, useEditor.getState().zoom) - pointer;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  /** Timeline time under a pointer, from its position in the scrolled lanes. */
  function pointerTime(clientX: number): Micros {
    const element = scrollRef.current!;
    const x = clientX - element.getBoundingClientRect().left - HEADER_WIDTH + element.scrollLeft;
    return Math.max(0, xToTime(x, zoom));
  }

  function measureRows(): RowBox[] {
    return rows.flatMap((row) => {
      const element = rowRefs.current.get(row.track.id);
      if (!element) return [];
      const box = element.getBoundingClientRect();
      return [{ trackId: row.track.id, top: box.top, bottom: box.bottom }];
    });
  }

  function threshold(): Micros {
    return xToTime(SNAP_PIXELS, zoom);
  }

  function capture(event: PointerEvent) {
    scrollRef.current!.setPointerCapture(event.pointerId);
  }

  function onClipPointerDown(event: PointerEvent, clipId: Id, edge: Edge | null) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const { project: current, time } = useEditor.getState();
    const row = rows.find((r) => r.track.clips.some((c) => c.id === clipId));
    const clip = row?.track.clips.find((c) => c.id === clipId);
    if (!row || !clip || row.track.locked) return;

    if (event.shiftKey || event.ctrlKey || event.metaKey) return select([clipId], "toggle");
    if (!selection.includes(clipId)) select([clipId]);

    capture(event);
    const targets = snapTargets(current, { playhead: time, exclude: new Set([clipId]) });
    const fromTime = pointerTime(event.clientX);
    if (edge) {
      beginGesture();
      dragRef.current = {
        kind: "trim",
        clipId,
        edge,
        edgeTime: edge === "start" ? clip.start : clipEnd(clip),
        fromTime,
        targets,
      };
    } else {
      dragRef.current = {
        kind: "pending",
        clipId,
        fromX: event.clientX,
        fromY: event.clientY,
        fromTime,
        clipStart: clip.start,
        length: clipDuration(clip),
        boxes: measureRows(),
        targets,
      };
    }
  }

  function onLanePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    capture(event);
    select([]);
    dragRef.current = { kind: "seek" };
    seekTo(event.clientX);
  }

  function seekTo(clientX: number) {
    const { snapping, project: current } = useEditor.getState();
    let time = pointerTime(clientX);
    if (snapping) {
      const snapped = snapTime(time, snapTargets(current), threshold());
      time = snapped.time;
      setGuide(snapped.target);
    }
    seek(time);
  }

  function onPointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const { snapping } = useEditor.getState();

    if (drag.kind === "seek") return seekTo(event.clientX);

    const time = pointerTime(event.clientX);
    if (drag.kind === "trim") {
      let edgeTime = drag.edgeTime + (time - drag.fromTime);
      if (snapping) {
        const snapped = snapTime(edgeTime, drag.targets, threshold());
        edgeTime = snapped.time;
        setGuide(snapped.target);
      }
      updateGesture((p) => trimClip(p, drag.clipId, drag.edge, edgeTime));
      return;
    }

    if (drag.kind === "pending") {
      if (Math.hypot(event.clientX - drag.fromX, event.clientY - drag.fromY) < DRAG_THRESHOLD) return;
      beginGesture();
      drag.kind = "move";
    }

    let start = Math.max(0, drag.clipStart + (time - drag.fromTime));
    if (snapping) {
      const snapped = snapRange(start, drag.length, drag.targets, threshold());
      start = Math.max(0, snapped.time);
      setGuide(snapped.target);
    }
    const target = rowAt(drag.boxes, event.clientY);
    const mainId = project.tracks[0]!.id;
    const placement: Placement =
      target.kind === "track"
        ? // The main track places by where the pointer is; other tracks by the clip's start.
          { trackId: target.trackId, time: target.trackId === mainId ? time : start }
        : { time: start };
    updateGesture((p) => moveClip(p, drag.clipId, placement));
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    setGuide(null);
    if (drag && (drag.kind === "move" || drag.kind === "trim")) endGesture();
  }

  function onDragOver(event: DragEvent) {
    if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDrop(event: DragEvent) {
    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
    const asset = assetId && useEditor.getState().project.assets[assetId];
    if (!asset) return;
    event.preventDefault();
    const target = rowAt(measureRows(), event.clientY);
    const time = pointerTime(event.clientX);
    addToTimeline(asset, target.kind === "track" ? { trackId: target.trackId, time } : { time });
  }

  return (
    <section aria-label="Timeline" className="flex min-h-0 min-w-0 flex-col bg-panel">
      <TimelineToolbar viewWidth={view.width} />
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-auto overscroll-contain"
        onScroll={(event) => {
          // Read now: React clears currentTarget before a state updater runs.
          const left = event.currentTarget.scrollLeft;
          setView((v) => ({ ...v, left }));
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="relative min-h-full" style={{ width: HEADER_WIDTH + contentWidth }}>
          <div className="sticky top-0 z-20 flex border-b border-border bg-panel" style={{ height: RULER_HEIGHT }}>
            <div className="sticky left-0 z-10 shrink-0 border-r border-border bg-panel" style={{ width: HEADER_WIDTH }} />
            <Ruler view={view} onPointerDown={onLanePointerDown} />
          </div>

          <div className="pb-10 pt-3">
            {rows.map((row) => (
              <div
                key={row.track.id}
                ref={(element) => {
                  if (element) rowRefs.current.set(row.track.id, element);
                  else rowRefs.current.delete(row.track.id);
                }}
                className={`flex border-b border-border ${row.isMain ? "bg-lane-main" : ""}`}
                style={{ height: row.height }}
              >
                <TrackHeader row={row} />
                <div className="relative flex-1" onPointerDown={onLanePointerDown}>
                  {row.track.clips.map((clip) => (
                    <ClipItem
                      key={clip.id}
                      clip={clip}
                      asset={project.assets[clip.assetId]!}
                      zoom={zoom}
                      height={row.height}
                      selected={selection.includes(clip.id)}
                      locked={row.track.locked}
                      onPointerDown={onClipPointerDown}
                    />
                  ))}
                  {row.isMain && empty && (
                    <p className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-xs text-subtle">
                      Drag media here, or press + on a file.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <Playhead scrollRef={scrollRef} />
          {guide !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-warning"
              style={{ left: HEADER_WIDTH + timeToX(guide, zoom) }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The playhead moves every frame during playback, so it updates its own
 * position from the store instead of re-rendering the timeline. It also
 * scrolls the timeline to keep itself in view while playing.
 */
function Playhead({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const place = () => {
      const { time, zoom, playing } = useEditor.getState();
      const x = timeToX(time, zoom);
      ref.current!.style.transform = `translateX(${x}px)`;
      const scroller = scrollRef.current;
      if (!playing || !scroller) return;
      const visible = scroller.clientWidth - HEADER_WIDTH;
      if (x > scroller.scrollLeft + visible - 24 || x < scroller.scrollLeft) {
        scroller.scrollLeft = Math.max(0, x - 24);
      }
    };
    place();
    return useEditor.subscribe((state, previous) => {
      if (state.time !== previous.time || state.zoom !== previous.zoom) place();
    });
  }, [scrollRef]);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute bottom-0 top-0 z-30"
      style={{ left: HEADER_WIDTH }}
    >
      <div className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-b-[3px] bg-accent" />
      <div className="absolute left-0 top-0 h-full w-px bg-accent" />
    </div>
  );
}
