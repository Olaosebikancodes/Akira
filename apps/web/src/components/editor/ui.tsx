"use client";

import type { Icon } from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function IconButton({
  icon: Glyph,
  label,
  shortcut,
  onClick,
  disabled,
  active,
}: {
  icon: Icon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  /** For toggles: rendered pressed. */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      disabled={disabled}
      className={`press grid size-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-foreground disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-raised aria-pressed:text-foreground ${FOCUS} ${active ? "text-foreground" : ""}`}
    >
      <Glyph size={17} weight="regular" aria-hidden />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const look =
    variant === "primary"
      ? "bg-accent text-accent-foreground hover:bg-accent-hover"
      : "bg-raised text-foreground hover:bg-raised-hover";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium disabled:pointer-events-none disabled:opacity-40 ${look} ${FOCUS}`}
    >
      {children}
    </button>
  );
}

/** A labelled slider with a typed number beside it, so every value is reachable by keyboard. */
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Fires continuously while dragging. */
  onChange: (value: number) => void;
  /** Fires once when a drag or typed edit finishes. */
  onCommit?: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          aria-label={`${label} value`}
          value={Number(value.toFixed(2))}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(clamp(parsed));
          }}
          onBlur={onCommit}
          className={`h-6 w-14 rounded border border-border bg-raised px-1.5 text-right font-mono text-xs tabular-nums disabled:opacity-40 ${FOCUS}`}
        />
        {unit && <span className="w-3 text-xs text-subtle">{unit}</span>}
      </div>
      <input
        id={id}
        type="range"
        className="slider col-span-2 w-full disabled:opacity-40"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  columns,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Lays long option lists out in a grid instead of one row. */
  columns?: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${columns ? "grid" : "flex"} gap-1 rounded-md bg-raised p-0.5`}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`press min-w-0 flex-1 rounded-[5px] px-2 py-1 text-xs font-medium text-muted hover:text-foreground aria-checked:bg-control-on aria-checked:text-foreground ${FOCUS}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-tight text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export const focusRing = FOCUS;
