"use client";

import { type Project, projectDuration } from "@akira/engine";
import { useEffect, useRef, useState } from "react";
import {
  CODEC_NAMES,
  estimatedSize,
  exportSize,
  type ExportSettings,
  formatSize,
  framesPerSecond,
  isVertical,
  masterDimensions,
  type MasterPlan,
  type MasterSize,
  masterSizeFor,
  masterSizes,
  planMaster,
  type QualityChoice,
  RESOLUTIONS,
  tiktokBitrate,
  tiktokShortSide,
  type TikTokSize,
  UPLOAD_TIPS,
} from "./export-settings";
import { useEditor } from "./store";
import { Button, focusRing, Segmented } from "./ui";

/** Closes on Escape or a click outside, like a menu. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [ref, onClose]);
}

/**
 * The master plan for a size, worked out again when the project's shape or
 * frame rate changes. Undefined while the browser is being asked, and when
 * `size` is null.
 */
function useMasterPlan(size: MasterSize | null): MasterPlan | null | undefined {
  const key = useEditor((s) => {
    if (!size) return null;
    const { width, height, frameRate } = s.project.canvas;
    return `${size} ${width}×${height} ${frameRate.num}/${frameRate.den}`;
  });
  const [result, setResult] = useState<{ key: string; plan: MasterPlan | null } | null>(null);
  useEffect(() => {
    if (!key || !size) return;
    let current = true;
    void planMaster(useEditor.getState().project, size).then((plan) => {
      if (current) setResult({ key, plan });
    });
    return () => {
      current = false;
    };
  }, [key, size]);
  return key && result?.key === key ? result.plan : undefined;
}

/** Format, size and quality for an export, or the TikTok or master preset. */
export function ExportPanel({
  settings,
  onChange,
  onExport,
  onClose,
}: {
  settings: ExportSettings;
  onChange: (settings: ExportSettings) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const project = useEditor((s) => s.project);
  const set = (change: Partial<ExportSettings>) => onChange({ ...settings, ...change });
  const { preset } = settings;
  const masterSize = masterSizeFor(project, settings.masterSize);
  const plan = useMasterPlan(preset === "master" ? masterSize : null);
  const size = exportSize(project, Number(settings.resolution));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Export settings"
      className="absolute right-0 top-full z-50 mt-2 flex w-80 flex-col gap-4 rounded-lg border border-border-strong bg-panel p-4 shadow-[0_16px_40px_oklch(0%_0_0/0.5)]"
    >
      <Segmented
        label="Export preset"
        value={preset}
        options={[
          { value: "custom", label: "Custom" },
          { value: "tiktok", label: "TikTok" },
          { value: "master", label: "Master" },
        ]}
        onChange={(preset) => set({ preset })}
      />

      {preset === "tiktok" ? (
        <TikTokSettings project={project} size={settings.tiktokSize} onSize={(tiktokSize) => set({ tiktokSize })} />
      ) : preset === "master" ? (
        <MasterSettings project={project} size={masterSize} plan={plan} onSize={(masterSize) => set({ masterSize })} />
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Format</span>
            <Segmented
              label="Format"
              value={settings.format}
              options={[
                { value: "mp4", label: "MP4 (H.264)" },
                { value: "webm", label: "WebM (VP9)" },
              ]}
              onChange={(format) => set({ format })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Resolution</span>
            <Segmented label="Resolution" value={settings.resolution} options={RESOLUTIONS} onChange={(resolution) => set({ resolution })} columns={4} />
            <span className="font-mono text-[11px] tabular-nums text-subtle">
              {size.width} × {size.height}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Quality</span>
            <Segmented<QualityChoice>
              label="Quality"
              value={settings.quality}
              options={[
                { value: "smaller", label: "Smaller" },
                { value: "balanced", label: "Balanced" },
                { value: "best", label: "Best" },
              ]}
              onChange={(quality) => set({ quality })}
            />
          </div>
        </>
      )}

      <Button variant="primary" onClick={onExport} disabled={preset === "master" && !plan}>
        Export video
      </Button>
    </div>
  );
}

/** TikTok's preset: 1080p, or the biggest file TikTok accepts as an experiment. */
function TikTokSettings({ project, size, onSize }: { project: Project; size: TikTokSize; onSize: (size: TikTokSize) => void }) {
  const duration = projectDuration(project);
  const frame = exportSize(project, tiktokShortSide(size));
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Size</span>
        <Segmented<TikTokSize>
          label="TikTok size"
          value={size}
          options={[
            { value: "1080", label: "1080p" },
            { value: "max", label: "Max (4K)" },
          ]}
          onChange={onSize}
        />
      </div>
      <div className="flex flex-col gap-2 text-xs text-muted">
        <p className="text-foreground">
          {frame.width} × {frame.height} MP4 at {framesPerSecond(project)} fps, about {formatSize(estimatedSize(tiktokBitrate(duration, size), duration))}
        </p>
        <p>
          Lightly cleaned up and sharpened so TikTok’s re-compression has the best start, at a bitrate that keeps the file under
          its upload limit. Suits Reels and Shorts too.
        </p>
        {size === "max" && (
          <p>
            An experiment: the biggest file TikTok accepts, up to 4096 pixels a side and 60 fps. TikTok still re-compresses it and
            most viewers still get 1080p; only TikTok decides what it shows. Compare it with a 1080p upload before relying on it.
          </p>
        )}
        {!isVertical(project) && (
          <p role="alert" className="text-warning">
            This project isn’t 9:16, so it won’t fill a phone screen. Change the aspect ratio under Project first.
          </p>
        )}
      </div>
    </>
  );
}

/** The master preset: the full picture at the project's frame rate, in the best codec this device can encode. */
function MasterSettings({
  project,
  size,
  plan,
  onSize,
}: {
  project: Project;
  size: MasterSize;
  plan: MasterPlan | null | undefined;
  onSize: (size: MasterSize) => void;
}) {
  const duration = projectDuration(project);
  const frame = masterDimensions(project, size);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Size</span>
        <Segmented<MasterSize> label="Master size" value={size} options={masterSizes(project)} onChange={onSize} />
      </div>
      <div className="flex flex-col gap-2 text-xs text-muted">
        <p className="text-foreground">
          {frame.width} × {frame.height} at {framesPerSecond(project)} fps
          {plan && (
            <>
              , {CODEC_NAMES[plan.codec]} MP4 at {Math.round(plan.bitrate / 1_000_000)} Mb/s, about{" "}
              {formatSize(estimatedSize(plan.bitrate, duration))}
            </>
          )}
        </p>
        {plan === undefined && <p>Checking what this browser can encode…</p>}
        {plan === null && (
          <p role="alert" className="text-warning">
            This browser can’t encode video this big. Pick a smaller size, or try Chrome or Edge on a computer with a newer
            graphics chip.
          </p>
        )}
        {plan && !plan.hardware && (
          <p role="alert" className="text-warning">
            This device has no hardware encoder for {CODEC_NAMES[plan.codec]} at this size, so it encodes in software. Expect it to
            take many times the video’s length.
          </p>
        )}
        <p>
          Keeps everything: the full picture, every frame at the project’s rate, and a bitrate high enough for fine detail and
          grain. For YouTube, archiving or editing again. TikTok re-compresses whatever it gets, so use the TikTok preset for
          TikTok.
        </p>
        {size !== "original" && (
          <p>Upscaled with AMD FSR 1 wherever footage is smaller than this. It sharpens edges, but can’t add detail the camera didn’t record.</p>
        )}
      </div>
    </>
  );
}

/** Shown after a TikTok export: how to keep the quality through upload. */
export function UploadTips({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Upload tips"
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border-strong bg-panel p-4 text-xs shadow-[0_16px_40px_oklch(0%_0_0/0.5)]"
    >
      <h2 className="text-[13px] font-semibold">Before you post</h2>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-muted">
        {UPLOAD_TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <button type="button" onClick={onClose} className={`press mt-3 rounded px-1.5 py-0.5 text-muted hover:bg-raised hover:text-foreground ${focusRing}`}>
        Got it
      </button>
    </div>
  );
}
