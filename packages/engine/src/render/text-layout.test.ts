import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "../project/model";
import { layoutText, revealedCharacters } from "./text-layout";

// Every character is 10px wide, so widths are easy to reason about.
const measure = (text: string) => text.length * 10;
const plain: TextStyle = { ...DEFAULT_TEXT_STYLE, shadow: null, lineHeight: 1 };

describe("layoutText", () => {
  it("stacks lines and centres each one in the widest", () => {
    const layout = layoutText("Hello\nHi", plain, 20, measure);
    const [first, second] = layout.lines;
    expect(first).toMatchObject({ text: "Hello", width: 50, x: 2, y: 12 });
    expect(second).toMatchObject({ text: "Hi", width: 20, x: 17, y: 32 });
    expect(layout).toMatchObject({ width: 54, height: 44 });
  });

  it("aligns lines left and right", () => {
    expect(layoutText("Hello\nHi", { ...plain, align: "left" }, 20, measure).lines[1]!.x).toBe(2);
    expect(layoutText("Hello\nHi", { ...plain, align: "right" }, 20, measure).lines[1]!.x).toBe(32);
  });

  it("pads the background box around the text", () => {
    const boxed = { ...plain, background: { color: "#000000", opacity: 1, padding: 0.5, radius: 0 } };
    const layout = layoutText("Hi", boxed, 20, measure);
    expect(layout.box).toEqual({ x: 2, y: 2, width: 40, height: 40 });
    expect(layout.lines[0]).toMatchObject({ x: 12, y: 22 });
  });

  it("leaves room for outlines and shadows", () => {
    const outlined = { ...plain, stroke: { color: "#000000", width: 0.1 } };
    expect(layoutText("Hi", outlined, 20, measure).box.x).toBe(4);
    const shadowed = { ...plain, shadow: { color: "#000000", blur: 0.1, offsetX: 0, offsetY: 0.2 } };
    expect(layoutText("Hi", shadowed, 20, measure).box.x).toBe(10);
  });

  it("keeps empty lines in the height", () => {
    expect(layoutText("A\n\nB", plain, 20, measure).lines.map((line) => line.y)).toEqual([12, 32, 52]);
  });
});

describe("revealedCharacters", () => {
  it("counts characters to show, ignoring line breaks", () => {
    expect(revealedCharacters("ab\ncd", 0.5)).toBe(2);
    expect(revealedCharacters("ab\ncd", 1)).toBe(4);
    expect(revealedCharacters("ab\ncd", -1)).toBe(0);
  });
});
