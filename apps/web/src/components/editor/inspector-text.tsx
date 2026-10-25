"use client";

import {
  BUILT_IN_FONTS,
  type Clip,
  type ClipAnimation,
  type InAnimation,
  type LoopAnimation,
  microsToSeconds,
  type OutAnimation,
  secondsToMicros,
  setClipAnimation,
  type TextStyle,
  updateText,
} from "@akira/engine";
import { TextBIcon, TextItalicIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useMemo, useRef } from "react";
import { commit, endGesture, liveEdit, useEditor } from "./store";
import { focusRing, IconButton, Section, Segmented, SliderField } from "./ui";

/** Words, font and look of a text clip, plus its outline, shadow and background box. */
export function TextSections({ clip }: { clip: Clip }) {
  const text = clip.text!;
  const { style } = text;
  const assets = useEditor((s) => s.project.assets);
  const focusRequest = useEditor((s) => s.textFocusRequest);
  const fonts = useMemo(
    () => [
      ...Object.values(assets).flatMap((asset) => (asset.font ? [asset.font.family] : [])),
      ...BUILT_IN_FONTS.map((font) => font.family),
    ],
    [assets],
  );
  const textId = useId();
  const fontId = useId();
  const colorId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);

  // A double-click on the canvas or a new text clip asks for the text box.
  useEffect(() => {
    if (focusRequest === 0) return;
    textRef.current?.focus();
    textRef.current?.select();
  }, [focusRequest]);

  const restyle = (change: Partial<TextStyle>) => liveEdit((p) => updateText(p, clip.id, { style: change }));
  const restyleNow = (change: Partial<TextStyle>) => commit((p) => updateText(p, clip.id, { style: change }));

  return (
    <>
      <Section title="Text">
        <label htmlFor={textId} className="sr-only">
          Text
        </label>
        <textarea
          id={textId}
          ref={textRef}
          value={text.content}
          rows={3}
          spellCheck
          onChange={(event) => liveEdit((p) => updateText(p, clip.id, { content: event.target.value }))}
          onBlur={endGesture}
          className={`resize-y rounded-md border border-border bg-raised px-2.5 py-2 text-[13px] leading-snug text-foreground ${focusRing}`}
        />
        <div className="flex items-center gap-2">
          <label htmlFor={fontId} className="sr-only">
            Font
          </label>
          <select
            id={fontId}
            value={style.font}
            onChange={(event) => restyleNow({ font: event.target.value })}
            className={`h-8 min-w-0 flex-1 rounded-md border border-border bg-raised px-2 text-xs text-foreground ${focusRing}`}
          >
            {fonts.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
          <IconButton icon={TextBIcon} label="Bold" active={style.bold} onClick={() => restyleNow({ bold: !style.bold })} />
          <IconButton icon={TextItalicIcon} label="Italic" active={style.italic} onClick={() => restyleNow({ italic: !style.italic })} />
          <input
            id={colorId}
            type="color"
            aria-label="Text colour"
            value={style.color}
            onChange={(event) => restyle({ color: event.target.value })}
            onBlur={endGesture}
            className={`h-8 w-9 shrink-0 cursor-pointer rounded border border-border bg-raised ${focusRing}`}
          />
        </div>
        <Segmented
          label="Alignment"
          value={style.align}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centre" },
            { value: "right", label: "Right" },
          ]}
          onChange={(align) => restyleNow({ align })}
        />
        <SliderField label="Size" unit="%" value={style.size * 100} min={1} max={40} step={0.5} onChange={(v) => restyle({ size: v / 100 })} onCommit={endGesture} />
        <SliderField label="Letter spacing" unit="%" value={style.letterSpacing * 100} min={-10} max={60} step={1} onChange={(v) => restyle({ letterSpacing: v / 100 })} onCommit={endGesture} />
        <SliderField label="Line height" unit="×" value={style.lineHeight} min={0.7} max={2.5} step={0.05} onChange={(v) => restyle({ lineHeight: v })} onCommit={endGesture} />
      </Section>

      <Toggled
        title="Outline"
        on={style.stroke !== null}
        onToggle={(on) => restyleNow({ stroke: on ? { color: "#000000", width: 0.06 } : null })}
      >
        {style.stroke && (
          <>
            <ColorRow label="Outline colour" value={style.stroke.color} onChange={(color) => restyle({ stroke: { ...style.stroke!, color } })} />
            <SliderField label="Width" unit="%" value={style.stroke.width * 100} min={1} max={30} step={1} onChange={(v) => restyle({ stroke: { ...style.stroke!, width: v / 100 } })} onCommit={endGesture} />
          </>
        )}
      </Toggled>

      <Toggled
        title="Shadow"
        on={style.shadow !== null}
        onToggle={(on) => restyleNow({ shadow: on ? { color: "#000000", blur: 0.12, offsetX: 0, offsetY: 0.04 } : null })}
      >
        {style.shadow && (
          <>
            <ColorRow label="Shadow colour" value={style.shadow.color} onChange={(color) => restyle({ shadow: { ...style.shadow!, color } })} />
            <SliderField label="Blur" unit="%" value={style.shadow.blur * 100} min={0} max={100} step={1} onChange={(v) => restyle({ shadow: { ...style.shadow!, blur: v / 100 } })} onCommit={endGesture} />
            <SliderField label="Distance" unit="%" value={style.shadow.offsetY * 100} min={0} max={50} step={1} onChange={(v) => restyle({ shadow: { ...style.shadow!, offsetY: v / 100 } })} onCommit={endGesture} />
          </>
        )}
      </Toggled>

      <Toggled
        title="Background"
        on={style.background !== null}
        onToggle={(on) => restyleNow({ background: on ? { color: "#000000", opacity: 0.7, padding: 0.3, radius: 0.15 } : null })}
      >
        {style.background && (
          <>
            <ColorRow label="Background colour" value={style.background.color} onChange={(color) => restyle({ background: { ...style.background!, color } })} />
            <SliderField label="Background opacity" unit="%" value={style.background.opacity * 100} min={0} max={100} step={1} onChange={(v) => restyle({ background: { ...style.background!, opacity: v / 100 } })} onCommit={endGesture} />
            <SliderField label="Padding" unit="%" value={style.background.padding * 100} min={0} max={150} step={1} onChange={(v) => restyle({ background: { ...style.background!, padding: v / 100 } })} onCommit={endGesture} />
            <SliderField label="Roundness" unit="%" value={style.background.radius * 100} min={0} max={100} step={1} onChange={(v) => restyle({ background: { ...style.background!, radius: v / 100 } })} onCommit={endGesture} />
          </>
        )}
      </Toggled>
    </>
  );
}

const IN_OPTIONS: { value: InAnimation | "none"; label: string; textOnly?: boolean }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-left", label: "Slide left" },
  { value: "typewriter", label: "Typewriter", textOnly: true },
];
const OUT_OPTIONS: { value: OutAnimation | "none"; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide-down", label: "Slide down" },
];
const LOOP_OPTIONS: { value: LoopAnimation | "none"; label: string }[] = [
  { value: "none", label: "None" },
  { value: "pulse", label: "Pulse" },
  { value: "bounce", label: "Bounce" },
];

/** How a clip enters, leaves and moves while on screen. */
export function AnimationSection({ clip }: { clip: Clip }) {
  const animation = clip.animation;
  const set = (change: Partial<ClipAnimation>) => commit((p) => setClipAnimation(p, clip.id, change));
  const setLive = (change: Partial<ClipAnimation>) => liveEdit((p) => setClipAnimation(p, clip.id, change));
  const inOptions = IN_OPTIONS.filter((option) => !option.textOnly || clip.text);

  return (
    <Section title="Animation">
      <AnimationRow
        label="In"
        options={inOptions}
        value={animation?.in?.kind ?? "none"}
        onChange={(kind) => set({ in: kind === "none" ? null : { kind, duration: animation?.in?.duration ?? 600_000 } })}
      />
      {animation?.in && (
        <SliderField label="In duration" unit="s" value={microsToSeconds(animation.in.duration)} min={0.1} max={5} step={0.1} onChange={(v) => setLive({ in: { ...animation.in!, duration: secondsToMicros(v) } })} onCommit={endGesture} />
      )}
      <AnimationRow
        label="Out"
        options={OUT_OPTIONS}
        value={animation?.out?.kind ?? "none"}
        onChange={(kind) => set({ out: kind === "none" ? null : { kind, duration: animation?.out?.duration ?? 500_000 } })}
      />
      {animation?.out && (
        <SliderField label="Out duration" unit="s" value={microsToSeconds(animation.out.duration)} min={0.1} max={5} step={0.1} onChange={(v) => setLive({ out: { ...animation.out!, duration: secondsToMicros(v) } })} onCommit={endGesture} />
      )}
      <AnimationRow
        label="Loop"
        options={LOOP_OPTIONS}
        value={animation?.loop?.kind ?? "none"}
        onChange={(kind) => set({ loop: kind === "none" ? null : { kind, period: animation?.loop?.period ?? 1_200_000 } })}
      />
      {animation?.loop && (
        <SliderField label="Loop length" unit="s" value={microsToSeconds(animation.loop.period)} min={0.2} max={4} step={0.1} onChange={(v) => setLive({ loop: { ...animation.loop!, period: secondsToMicros(v) } })} onCommit={endGesture} />
      )}
    </Section>
  );
}

function AnimationRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={`h-7 w-36 rounded-md border border-border bg-raised px-2 text-xs text-foreground ${focusRing}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A section switched on and off with a checkbox in its heading. */
function Toggled({ title, on, onToggle, children }: { title: string; on: boolean; onToggle: (on: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <Section
      title={title}
      action={
        <input
          id={id}
          type="checkbox"
          aria-label={`Use ${title.toLowerCase()}`}
          checked={on}
          onChange={(event) => onToggle(event.target.checked)}
          className={`size-4 cursor-pointer accent-accent ${focusRing}`}
        />
      }
    >
      {children}
    </Section>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={endGesture}
        className={`h-7 w-12 cursor-pointer rounded border border-border bg-raised ${focusRing}`}
      />
    </div>
  );
}
