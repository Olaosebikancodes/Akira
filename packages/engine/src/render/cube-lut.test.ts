import { describe, expect, it } from "vitest";
import { LutError, lutAt, parseCube } from "./cube-lut";

/** A 2×2×2 identity table with red varying fastest, as the format requires. */
const IDENTITY = `# Made by hand
TITLE "Identity"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

describe("parseCube", () => {
  it("reads the title, size and table, red varying fastest", () => {
    const lut = parseCube(IDENTITY);
    expect(lut.title).toBe("Identity");
    expect(lut.size).toBe(2);
    expect(lutAt(lut, 1, 0, 0)).toEqual([1, 0, 0]);
    expect(lutAt(lut, 0, 1, 1)).toEqual([0, 1, 1]);
    expect(lut.domainMin).toEqual([0, 0, 0]);
  });

  it("reads domains in both the current and the older Resolve style", () => {
    expect(parseCube(`DOMAIN_MIN 0 0 0.1\nDOMAIN_MAX 1 1 0.9\n${IDENTITY}`).domainMax).toEqual([1, 1, 0.9]);
    expect(parseCube(`LUT_3D_INPUT_RANGE 0.0 2.0\n${IDENTITY}`).domainMax).toEqual([2, 2, 2]);
  });

  it("copes with Windows line endings, a BOM and unknown metadata", () => {
    const messy = `﻿${IDENTITY.replace(/\n/g, "\r\n")}LUT_IN_VIDEO_RANGE\r\n`;
    expect(parseCube(messy).size).toBe(2);
  });

  it("explains what's wrong with files it can't use", () => {
    expect(() => parseCube("LUT_1D_SIZE 1024\n0 0 0")).toThrow(/1D LUT/);
    expect(() => parseCube("0 0 0\n1 1 1")).toThrow(/how big/);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n1 1 1")).toThrow(/should have 8 colours but has 2/);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 zero")).toThrow(LutError);
  });
});
