"use client";

import { projectDuration } from "@akira/engine";
import { useEffect, useRef } from "react";
import {
  estimatedSize,
  exportSize,
  type ExportSettings,
  isVertical,
  type QualityChoice,
  RESOLUTIONS,
  tiktokBitrate,
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

/** Format, size and quality for an export, or the TikTok preset. */
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
  const duration = projectDuration(project);
  const set = (change: Partial<ExportSettings>) => onChange({ ...settings, ...change });
  const tiktok = settings.preset === "tiktok";
  const size = exportSize(project, tiktok ? 1080 : Number(settings.resolution));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Export settings"
      className="absolute right-0 top-full z-50 mt-2 flex w-80 flex-col gap-4 rounded-lg border border-border-strong bg-panel p-4 shadow-[0_16px_40px_oklch(0%_0_0/0.5)]"
    >
      <Segmented
        label="Export preset"
        value={settings.preset}
        options={[
          { value: "custom", label: "Custom" },
          { value: "tiktok", label: "TikTok" },
        ]}
        onChange={(preset) => set({ preset })}
      />

      {tiktok ? (
        <div className="flex flex-col gap-2 text-xs text-muted">
          <p className="text-foreground">
            {size.width} × {size.height} MP4, about {(estimatedSize(tiktokBitrate(duration), duration) / 1_000_000).toFixed(0)} MB
          </p>
          <p>
            Lightly cleaned up and sharpened so TikTok’s re-compression has the best start, at a bitrate that keeps the file under
            its upload limit. Suits Reels and Shorts too.
          </p>
          {!isVertical(project) && (
            <p role="alert" className="text-warning">
              This project isn’t 9:16, so it won’t fill a phone screen. Change the aspect ratio under Project first.
            </p>
          )}
        </div>
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

      <Button variant="primary" onClick={onExport}>
        Export video
      </Button>
    </div>
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
