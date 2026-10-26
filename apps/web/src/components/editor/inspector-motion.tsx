"use client";

import { type Clip, motionCovers, setStabilize } from "@akira/engine";
import { useState } from "react";
import { beginTracking, stabilizeClip } from "./jobs";
import { commit, endGesture, liveEdit, setTrackingSetup, useEditor } from "./store";
import { Button, Section, SliderField, Toggle } from "./ui";

/** Steadies shaky footage; the shake is measured once in the background. */
export function StabilizeSection({ clip }: { clip: Clip }) {
  const measured = useEditor((s) => motionCovers(s.project, clip));
  const busy = useEditor((s) => s.jobs.some((job) => job.clipId === clip.id));

  return (
    <Section title="Stabilise">
      {clip.stabilize ? (
        <>
          <SliderField
            label="Strength"
            unit="%"
            value={clip.stabilize.strength * 100}
            min={0}
            max={100}
            step={1}
            onChange={(v) => liveEdit((p) => setStabilize(p, clip.id, v / 100))}
            onCommit={endGesture}
          />
          <p className="text-[11px] text-subtle">Stronger holds the frame stiller and zooms in a little more to hide the edges.</p>
          <Button onClick={() => commit((p) => setStabilize(p, clip.id, null))}>Remove stabilisation</Button>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-subtle">
            {busy ? "Measuring the shake in the background…" : measured ? "Shake already measured." : "Steadies handheld shots. The shake is measured once, in the background."}
          </span>
          <Button onClick={() => void stabilizeClip(clip.id)} disabled={busy}>
            Stabilise
          </Button>
        </div>
      )}
    </Section>
  );
}

/** Makes a clip follow something moving in the video beneath it. */
export function TrackingSection({ clip }: { clip: Clip }) {
  const [followScale, setFollowScale] = useState(false);
  const busy = useEditor((s) => s.jobs.some((job) => job.clipId === clip.id));
  const drawing = useEditor((s) => s.trackingSetup?.followerId === clip.id);

  return (
    <Section title="Motion tracking">
      <p className="text-[11px] text-subtle">
        Follow something moving in the video beneath this clip, from the playhead on. The path becomes keyframes you can adjust.
      </p>
      <Toggle label="Follow size too" checked={followScale} onChange={setFollowScale} />
      {drawing ? (
        <Button onClick={() => setTrackingSetup(null)}>Cancel drawing</Button>
      ) : (
        <Button onClick={() => beginTracking(clip.id, followScale)} disabled={busy}>
          {busy ? "Tracking…" : "Track an object"}
        </Button>
      )}
    </Section>
  );
}
