import { createProject, FPS_30, FPS_60, type Project } from "@akira/engine";
import { describe, expect, it } from "vitest";
import {
  estimatedSize,
  exportSize,
  formatSize,
  framesPerSecond,
  masterBitrate,
  masterDimensions,
  masterSizeFor,
  masterSizes,
  tiktokBitrate,
  tiktokShortSide,
} from "./export-settings";

function project(width: number, height: number, frameRate = FPS_30): Project {
  return createProject("Test", { width, height, frameRate, background: { kind: "color", color: "#000000" } });
}

describe("TikTok sizes", () => {
  it("makes 1080p by default and 2160 × 3840 at most, inside TikTok's 4096-pixel limit", () => {
    const vertical = project(1080, 1920);
    expect(exportSize(vertical, tiktokShortSide("1080"))).toEqual({ width: 1080, height: 1920 });
    expect(exportSize(vertical, tiktokShortSide("max"))).toEqual({ width: 2160, height: 3840 });
  });

  it("keeps the file under the upload limit, with more room for 4K on short videos", () => {
    expect(tiktokBitrate(30_000_000)).toBe(20_000_000);
    expect(tiktokBitrate(30_000_000, "max")).toBe(50_000_000);
    // Ten minutes has to fit the same 270 MB whatever the size.
    const long = 600_000_000;
    expect(tiktokBitrate(long, "max")).toBe(tiktokBitrate(long));
    expect(estimatedSize(tiktokBitrate(long, "max"), long)).toBeLessThanOrEqual(270_000_000);
  });
});

describe("master exports", () => {
  it("keeps the project's size, and offers only upscales bigger than it", () => {
    expect(masterSizes(project(1080, 1920)).map((size) => size.label)).toEqual(["Original", "4K", "8K"]);
    expect(masterSizes(project(3840, 2160)).map((size) => size.label)).toEqual(["Original", "8K"]);
    expect(masterSizes(project(7680, 4320)).map((size) => size.label)).toEqual(["Original"]);
    expect(masterDimensions(project(7680, 4320), "original")).toEqual({ width: 7680, height: 4320 });
    expect(masterDimensions(project(1080, 1920), "4320")).toEqual({ width: 4320, height: 7680 });
  });

  it("falls back to the original when the project has outgrown the chosen upscale", () => {
    expect(masterSizeFor(project(3840, 2160), "2160")).toBe("original");
    expect(masterSizeFor(project(1920, 1080), "2160")).toBe("2160");
  });

  it("gives H.264 more bits than newer codecs, and caps what encoders accept", () => {
    expect(masterBitrate(3840, 2160, 30, "avc")).toBe(74_649_600);
    expect(masterBitrate(3840, 2160, 30, "av1")).toBeLessThan(masterBitrate(3840, 2160, 30, "avc"));
    expect(masterBitrate(7680, 4320, 60, "av1")).toBe(200_000_000);
  });

  it("shows the project's frame rate", () => {
    expect(framesPerSecond(project(1920, 1080, FPS_60))).toBe(60);
  });
});

describe("formatSize", () => {
  it("reads like a file manager, on one line", () => {
    expect(formatSize(420_000)).toBe("0.4 MB");
    expect(formatSize(84_000_000)).toBe("84 MB");
    expect(formatSize(3_200_000_000)).toBe("3.2 GB");
  });
});
