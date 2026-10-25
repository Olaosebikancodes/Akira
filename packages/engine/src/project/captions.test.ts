import { describe, expect, it } from "vitest";
import { parseSrt } from "./captions";

describe("parseSrt", () => {
  it("reads numbered cues with multi-line text", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,500\nHello there\nsecond line\n\n2\n00:01:02,250 --> 00:01:03,000\nBye\n";
    expect(parseSrt(srt)).toEqual([
      { start: 1_000_000, end: 4_500_000, text: "Hello there\nsecond line" },
      { start: 62_250_000, end: 63_000_000, text: "Bye" },
    ]);
  });

  it("copes with BOMs, Windows line endings, dots and missing numbers", () => {
    const srt = "﻿00:00:00.5 --> 00:00:01.25\r\nNo number\r\n\r\n";
    expect(parseSrt(srt)).toEqual([{ start: 500_000, end: 1_250_000, text: "No number" }]);
  });

  it("drops formatting tags and positioning", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000 X1:10 X2:20\n<i>Whispered</i> {\\an8}words\n";
    expect(parseSrt(srt)[0]!.text).toBe("Whispered words");
  });

  it("skips cues with no text or backwards timings, and sorts the rest", () => {
    const srt = "2\n00:00:05,000 --> 00:00:06,000\nLater\n\n1\n00:00:03,000 --> 00:00:02,000\nBackwards\n\n3\n00:00:01,000 --> 00:00:02,000\n\n\n4\n00:00:01,000 --> 00:00:02,000\nFirst\n";
    expect(parseSrt(srt).map((cue) => cue.text)).toEqual(["First", "Later"]);
  });

  it("reads hours", () => {
    expect(parseSrt("1:02:03,004 --> 1:02:04,000\nLate")[0]!.start).toBe(3_723_004_000);
  });
});
