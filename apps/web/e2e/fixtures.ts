import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Page } from "@playwright/test";

const FIXTURE_DIR = path.join(__dirname, ".fixtures");

export const FIXTURES = {
  /** 3 s at 30 fps: one second each of red, green, blue, with a 440 Hz tone. */
  colors: path.join(FIXTURE_DIR, "colors.mp4"),
  /** 1 s of red over blue, tagged with a 90° rotation like phone footage. */
  rotated: path.join(FIXTURE_DIR, "rotated.mp4"),
  /** 20 s of slowly changing colour, long enough to cancel mid-export. */
  long: path.join(FIXTURE_DIR, "long.mp4"),
  /** 200×200 PNG: a green circle on a transparent background, like a sticker. */
  sticker: path.join(FIXTURE_DIR, "sticker.png"),
  /** 16×16 GIF that loops green then blue, half a second each. */
  animated: path.join(FIXTURE_DIR, "animated.gif"),
  /**
   * 8 s of trouble for the clean-up filters: 30 Hz rumble (0-2 s), 50 Hz
   * hum (2-4 s), then 1 kHz bursts over hiss (4-8 s), like speech in a noisy room.
   */
  dirty: path.join(FIXTURE_DIR, "dirty.wav"),
  /** Two captions: "Hello there" from 0.5 to 1.5 s and "Second line" from 2 to 3 s. */
  captions: path.join(FIXTURE_DIR, "captions.srt"),
  /** A real font file under a different name: its family becomes "Brand Font". */
  font: path.join(FIXTURE_DIR, "Brand_Font.woff2"),
  /** A 2×2×2 .cube LUT that swaps red and blue. */
  lut: path.join(FIXTURE_DIR, "Swap_Red_Blue.cube"),
  notMedia: path.join(FIXTURE_DIR, "notes.txt"),
};

/** Where each part of the dirty recording is, in seconds. */
export const DIRTY = { rumble: [0.2, 1.8], hum: [2.2, 3.8], bursts: 4 } as const;

/**
 * Builds the test clips inside the browser with Mediabunny, so the repo
 * carries no binary fixtures and the clips are exactly what the tests expect.
 */
export async function ensureFixtures(page: Page): Promise<void> {
  if (Object.values(FIXTURES).every((file) => existsSync(file))) return;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(FIXTURES.notMedia, "This is not a video.");
  writeFileSync(FIXTURES.animated, animatedGif());
  writeFileSync(FIXTURES.dirty, dirtyWav());
  // Windows line endings on purpose: plenty of real .srt files have them.
  writeFileSync(
    FIXTURES.captions,
    "1\r\n00:00:00,500 --> 00:00:01,500\r\nHello there\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nSecond line\r\n",
  );
  copyFileSync(path.join(__dirname, "../public/fonts/anton-400.woff2"), FIXTURES.font);
  writeFileSync(FIXTURES.lut, swapLut());

  const bundle = mediabunnyBundle();

  await page.goto("/");
  const clips = await page.evaluate(buildClips, bundle);
  writeFileSync(FIXTURES.colors, Buffer.from(clips.colors, "base64"));
  writeFileSync(FIXTURES.rotated, Buffer.from(clips.rotated, "base64"));
  writeFileSync(FIXTURES.long, Buffer.from(clips.long, "base64"));
  writeFileSync(FIXTURES.sticker, Buffer.from(clips.sticker, "base64"));
}

/** 16-bit mono WAV of the dirty recording described on FIXTURES.dirty. */
function dirtyWav(): Buffer {
  const rate = 48_000;
  const samples = new Int16Array(rate * 8);
  let seed = 3;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    let value: number;
    if (t < 2) value = 0.5 * Math.sin(2 * Math.PI * 30 * t);
    else if (t < 4) value = 0.3 * Math.sin(2 * Math.PI * 50 * t);
    else {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      const hiss = ((seed / 2 ** 32) * 2 - 1) * 0.05;
      value = hiss + ((t - 4) % 0.5 < 0.3 ? 0.3 * Math.sin(2 * Math.PI * 1000 * t) : 0);
    }
    samples[i] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer)]);
}

function mediabunnyBundle(): string {
  // Node resolves Mediabunny's Node build; the page needs the browser bundle.
  let packageDir = createRequire(__filename).resolve("mediabunny");
  while (path.basename(packageDir) !== "mediabunny") packageDir = path.dirname(packageDir);
  return readFileSync(path.join(packageDir, "dist/bundles/mediabunny.min.mjs"), "utf8");
}

/**
 * Decodes a file's audio in the page and returns its RMS level in each
 * window of seconds, so tests can check what an export actually sounds like.
 */
export async function audioLevels(page: Page, file: string, windows: readonly (readonly [number, number])[]): Promise<number[]> {
  return page.evaluate(
    async ({ bundle, base64, windows }) => {
      const url = URL.createObjectURL(new Blob([bundle], { type: "text/javascript" }));
      const importModule = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;
      const mb = (await importModule(url)) as typeof import("mediabunny");
      URL.revokeObjectURL(url);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const input = new mb.Input({ source: new mb.BufferSource(bytes.buffer), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryAudioTrack();
      if (!track) return windows.map(() => 0);
      const sums = windows.map(() => 0);
      const counts = windows.map(() => 0);
      for await (const { buffer, timestamp } of new mb.AudioBufferSink(track).buffers()) {
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < channel.length; i++) {
          const t = timestamp + i / buffer.sampleRate;
          windows.forEach(([from, to], w) => {
            if (t >= from && t < to) {
              sums[w]! += channel[i]! ** 2;
              counts[w]!++;
            }
          });
        }
      }
      return sums.map((sum, w) => Math.sqrt(sum / Math.max(1, counts[w]!)));
    },
    { bundle: mediabunnyBundle(), base64: readFileSync(file).toString("base64"), windows },
  );
}

/** Red becomes blue and blue becomes red: easy to see, and only a lookup table would do it. */
function swapLut(): string {
  const lines = ['TITLE "Swap red and blue"', "LUT_3D_SIZE 2"];
  // Red varies fastest, so each line's input is (r, g, b) and its output (b, g, r).
  for (const b of [0, 1]) for (const g of [0, 1]) for (const r of [0, 1]) lines.push(`${b} ${g} ${r}`);
  return `${lines.join("\n")}\n`;
}

/**
 * A two-frame looping GIF, written byte by byte because browsers can't encode
 * GIFs. Resetting the LZW table every two pixels keeps every code three bits
 * wide, which makes the compressor trivial.
 */
function animatedGif(): Buffer {
  const size = 16;
  const bytes: number[] = [];
  const push = (...values: number[]) => bytes.push(...values);
  const word = (value: number) => push(value & 0xff, value >> 8);

  push(...Buffer.from("GIF89a"));
  word(size);
  word(size);
  push(0b1000_0001, 0, 0); // Global colour table of 4 entries.
  push(0, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255); // Black, green, blue, white.
  push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0); // Loop forever.

  for (const colour of [1, 2]) {
    push(0x21, 0xf9, 4, 0, 50, 0, 0, 0); // Show for 50 hundredths of a second.
    push(0x2c);
    word(0);
    word(0);
    word(size);
    word(size);
    push(0);
    push(2); // Minimum code size: clear is 4, end is 5.
    const codes: number[] = [];
    for (let i = 0; i < size * size; i++) {
      if (i % 2 === 0) codes.push(4);
      codes.push(colour);
    }
    codes.push(5);
    const data: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const code of codes) {
      buffer |= code << bits;
      bits += 3;
      while (bits >= 8) {
        data.push(buffer & 0xff);
        buffer >>= 8;
        bits -= 8;
      }
    }
    if (bits > 0) data.push(buffer & 0xff);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      push(block.length, ...block);
    }
    push(0);
  }
  push(0x3b);
  return Buffer.from(bytes);
}

/** Runs in the page. Must be self-contained: it's serialised by Playwright. */
async function buildClips(
  bundle: string,
): Promise<{ colors: string; rotated: string; long: string; sticker: string }> {
  const url = URL.createObjectURL(new Blob([bundle], { type: "text/javascript" }));
  // Built from a string so the test transpiler can't turn import() into require().
  const importModule = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;
  const mb = (await importModule(url)) as typeof import("mediabunny");
  URL.revokeObjectURL(url);

  const width = 640;
  const height = 360;
  const fps = 30;

  async function encode(
    seconds: number,
    rotation: 0 | 90,
    paint: (ctx: OffscreenCanvasRenderingContext2D, frame: number) => void,
  ): Promise<string> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new mb.BufferTarget(),
    });
    const video = new mb.CanvasSource(canvas, { codec: "avc", quality: new mb.Quality("high") });
    output.addVideoTrack(video, { frameRate: fps, rotation });
    const audio = new mb.AudioBufferSource({ codec: "aac", quality: new mb.Quality("high") });
    output.addAudioTrack(audio);
    await output.start();

    const sampleRate = 48_000;
    const tone = new AudioBuffer({ numberOfChannels: 2, length: sampleRate * seconds, sampleRate });
    for (let channel = 0; channel < 2; channel++) {
      const data = tone.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const addAudio = (async () => {
      await audio.add(tone);
      audio.close();
    })();
    for (let frame = 0; frame < fps * seconds; frame++) {
      paint(ctx, frame);
      await video.add(frame / fps, 1 / fps);
    }
    video.close();
    await addAudio;
    await output.finalize();

    const bytes = new Uint8Array(output.target.buffer!);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  const colors = await encode(3, 0, (ctx, frame) => {
    ctx.fillStyle = ["#ff0000", "#00ff00", "#0000ff"][Math.floor(frame / fps)]!;
    ctx.fillRect(0, 0, width, height);
  });
  const rotated = await encode(1, 90, (ctx) => {
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, width, height / 2);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(0, height / 2, width, height / 2);
  });
  const long = await encode(20, 0, (ctx, frame) => {
    ctx.fillStyle = `hsl(${(frame * 2) % 360} 70% 50%)`;
    ctx.fillRect(0, 0, width, height);
  });
  const stickerCanvas = new OffscreenCanvas(200, 200);
  const stickerContext = stickerCanvas.getContext("2d")!;
  stickerContext.fillStyle = "#00ff00";
  stickerContext.beginPath();
  stickerContext.arc(100, 100, 90, 0, Math.PI * 2);
  stickerContext.fill();
  const stickerBytes = new Uint8Array(await (await stickerCanvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let stickerBinary = "";
  for (const byte of stickerBytes) stickerBinary += String.fromCharCode(byte);

  return { colors, rotated, long, sticker: btoa(stickerBinary) };
}
