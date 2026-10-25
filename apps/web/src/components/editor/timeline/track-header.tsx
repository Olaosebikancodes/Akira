"use client";

import { setTrackFlag, type TrackFlag } from "@akira/engine";
import {
  EyeIcon,
  EyeSlashIcon,
  type Icon,
  LockIcon,
  LockOpenIcon,
  SpeakerSimpleHighIcon,
  SpeakerSimpleSlashIcon,
} from "@phosphor-icons/react";
import { commit } from "../store";
import { focusRing } from "../ui";
import { HEADER_WIDTH, type Row } from "./layout";

/** Track label and its mute, hide and lock toggles. */
export function TrackHeader({ row }: { row: Row }) {
  const { track } = row;
  const name = row.isMain ? "Main" : track.kind === "audio" ? "Audio" : "Overlay";
  const toggle = (flag: TrackFlag) => commit((project) => setTrackFlag(project, track.id, flag, !track[flag]));

  return (
    <div
      className="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-1 border-r border-border bg-panel pl-2.5 pr-1"
      style={{ width: HEADER_WIDTH }}
    >
      <span className="truncate text-[11px] font-medium text-muted">{name}</span>
      <div className="flex">
        {track.kind === "video" && (
          <Toggle
            on={track.hidden}
            onIcon={EyeSlashIcon}
            offIcon={EyeIcon}
            label={`${track.hidden ? "Show" : "Hide"} ${name.toLowerCase()} track`}
            onClick={() => toggle("hidden")}
          />
        )}
        <Toggle
          on={track.muted}
          onIcon={SpeakerSimpleSlashIcon}
          offIcon={SpeakerSimpleHighIcon}
          label={`${track.muted ? "Unmute" : "Mute"} ${name.toLowerCase()} track`}
          onClick={() => toggle("muted")}
        />
        <Toggle
          on={track.locked}
          onIcon={LockIcon}
          offIcon={LockOpenIcon}
          label={`${track.locked ? "Unlock" : "Lock"} ${name.toLowerCase()} track`}
          onClick={() => toggle("locked")}
        />
      </div>
    </div>
  );
}

function Toggle({
  on,
  onIcon: OnIcon,
  offIcon: OffIcon,
  label,
  onClick,
}: {
  on: boolean;
  onIcon: Icon;
  offIcon: Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className={`press grid size-6 place-items-center rounded text-subtle hover:bg-raised hover:text-foreground aria-pressed:text-warning ${focusRing}`}
    >
      {on ? <OnIcon size={13} aria-hidden /> : <OffIcon size={13} aria-hidden />}
    </button>
  );
}
