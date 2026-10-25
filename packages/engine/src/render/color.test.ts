import { describe, expect, it } from "vitest";
import { parseHexColor } from "./color";

describe("parseHexColor", () => {
  it("parses #rrggbb with or without the hash", () => {
    expect(parseHexColor("#ff0000")).toEqual([1, 0, 0]);
    expect(parseHexColor("00FF00")).toEqual([0, 1, 0]);
  });

  it("falls back to black for anything else", () => {
    expect(parseHexColor("red")).toEqual([0, 0, 0]);
    expect(parseHexColor("#fff")).toEqual([0, 0, 0]);
  });
});
