"use client";

/**
 * Where TikTok's own interface sits over a 9:16 video, as fractions of the
 * frame: the tabs along the top, the buttons down the right, and the
 * caption and sound along the bottom. Keep text and faces out of them.
 */
const ZONES = [
  { label: "Following · For You", x: 0, y: 0, width: 1, height: 0.08 },
  { label: "Like, comment, share", x: 0.86, y: 0.36, width: 0.14, height: 0.42 },
  { label: "Name, caption and sound", x: 0, y: 0.8, width: 1, height: 0.2 },
] as const;

/** A guide drawn over the preview; it never shows in exports. */
export function SafeZones() {
  return (
    <div aria-hidden data-safe-zones className="pointer-events-none absolute inset-0">
      {ZONES.map((zone) => (
        <div
          key={zone.label}
          className="absolute border border-dashed border-[oklch(64%_0.2_27/0.7)] bg-[oklch(64%_0.2_27/0.18)] p-1 text-[10px] leading-tight text-white/85"
          style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` }}
        >
          {zone.label}
        </div>
      ))}
    </div>
  );
}
