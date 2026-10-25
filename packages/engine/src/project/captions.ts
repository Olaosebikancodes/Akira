import type { Micros } from "../time";

export interface Cue {
  start: Micros;
  end: Micros;
  text: string;
}

const TIMING = /(\d{1,2}:)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

/**
 * Reads SubRip (.srt) captions. Real files are messy, so this tolerates a
 * byte-order mark, Windows or old Mac line endings, missing or wrong cue
 * numbers, "." instead of "," before the milliseconds, positioning after
 * the timing, and formatting tags, and skips cues it can't make sense of.
 */
export function parseSrt(source: string): Cue[] {
  const blocks = source
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0) continue;
    const match = TIMING.exec(lines[timingIndex]!)!;
    const start = toMicros(match[1], match[2]!, match[3]!, match[4]!);
    const end = toMicros(match[5], match[6]!, match[7]!, match[8]!);
    const text = lines
      .slice(timingIndex + 1)
      .map((line) => line.replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").trim())
      .filter(Boolean)
      .join("\n");
    if (end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function toMicros(hours: string | undefined, minutes: string, seconds: string, fraction: string): Micros {
  const milliseconds = Number(fraction.padEnd(3, "0"));
  const total = (Number(hours?.slice(0, -1) ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 + milliseconds;
  return total * 1000;
}
