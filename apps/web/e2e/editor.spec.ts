import { expect, type Locator, type Page, test } from "@playwright/test";
import { audioLevels, DIRTY, ensureFixtures, FIXTURES } from "./fixtures";

type Colour = "red" | "green" | "blue" | "black" | "other";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await ensureFixtures(page);
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/editor");
  // The preview canvas is created once React has taken over the page. (Waiting
  // for network idle doesn't work: the dev server's worker loader stays connected.)
  await page.getByLabel("Video preview").waitFor();
});

// Helpers

async function importMedia(page: Page, ...files: string[]) {
  await page.getByLabel("Import", { exact: true }).setInputFiles(files);
}

/** Imports a file and adds it to the timeline with its + button. */
async function addClip(page: Page, file: string) {
  const name = file.split(/[\\/]/).pop()!;
  await importMedia(page, file);
  await page.getByRole("button", { name: `Add ${name} to timeline` }).click();
}

function preview(page: Page): Locator {
  return page.getByLabel("Video preview");
}

function clips(page: Page, name: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")},`) });
}

function duration(page: Page): Locator {
  return page.getByLabel("Duration");
}

function currentTime(page: Page): Locator {
  return page.getByLabel("Current time");
}

/** Tracks on the timeline, counted by their lock toggles. */
function tracks(page: Page): Locator {
  return page.getByRole("button", { name: /^(Lock|Unlock) .* track$/ });
}

function errorNotice(page: Page): Locator {
  return page.getByRole("alert").filter({ hasText: /\S/ });
}

/** The dominant colour at a point in the preview, as fractions of its width and height. */
async function colourAt(page: Page, x = 0.5, y = 0.5): Promise<Colour> {
  const [r, g, b] = await rgbAt(page, x, y);
  if (r > 150 && g < 100 && b < 100) return "red";
  if (g > 150 && r < 100 && b < 100) return "green";
  if (b > 150 && r < 100 && g < 100) return "blue";
  if (r < 30 && g < 30 && b < 30) return "black";
  return "other";
}

/** The exact colour at a point in the preview, 0-255 per channel. */
async function rgbAt(page: Page, x = 0.5, y = 0.5): Promise<[number, number, number]> {
  const png = await preview(page).screenshot();
  const [r, g, b] = await page.evaluate(
    async ({ base64, x, y }) => {
      const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
      const image = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const px = Math.min(image.width - 1, Math.floor(x * image.width));
      const py = Math.min(image.height - 1, Math.floor(y * image.height));
      return [...ctx.getImageData(px, py, 1, 1).data];
    },
    { base64: png.toString("base64"), x, y },
  );
  return [r!, g!, b!];
}

/** How far a colour is from grey: the gap between its strongest and weakest channel. */
async function chromaAt(page: Page, x = 0.5, y = 0.5): Promise<number> {
  const rgb = await rgbAt(page, x, y);
  return Math.max(...rgb) - Math.min(...rgb);
}

async function stepFrames(page: Page, count: number) {
  const key = count < 0 ? "ArrowLeft" : "ArrowRight";
  for (let i = 0; i < Math.abs(count); i++) await page.keyboard.press(key);
}

async function goToFrame(page: Page, frame: number) {
  await page.keyboard.press("Home");
  // Shift+arrow steps a second at a time; test projects run at 30 fps.
  for (let i = 0; i < Math.floor(frame / 30); i++) await page.keyboard.press("Shift+ArrowRight");
  await stepFrames(page, frame % 30);
}

async function libraryTab(page: Page, name: string) {
  await page.getByRole("tablist", { name: "Library" }).getByRole("tab", { name }).click();
}

async function clipTab(page: Page, name: string) {
  await page.getByRole("tablist", { name: "Clip settings" }).getByRole("tab", { name }).click();
}

/** Puts a second copy of a clip right after the first on the main track. */
async function addAgain(page: Page, name: string) {
  await libraryTab(page, "Media");
  await page.getByRole("button", { name: `Add ${name} to timeline` }).click();
}

/** Exports the project and returns the downloaded file's path. */
async function exportVideo(page: Page, name = "export.mp4"): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("link", { name: "Download MP4" }).click({ timeout: 60_000 });
  const file = test.info().outputPath(name);
  await (await downloadPromise).saveAs(file);
  await page.getByRole("button", { name: "Dismiss export" }).click();
  return file;
}

async function setNumber(page: Page, label: string, value: number) {
  const field = page.getByLabel(`${label} value`);
  await field.fill(String(value));
  await field.blur();
}

// Import and playback

test("imports media and adds it to the timeline", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await expect(duration(page)).toHaveText("00:00:03:00");
  await expect(clips(page, "colors.mp4")).toHaveCount(1);
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("steps frame by frame and lands on the exact frame", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 29);
  await expect(currentTime(page)).toHaveText("00:00:00:29");
  await expect.poll(() => colourAt(page)).toBe("red");
  await stepFrames(page, 1);
  await expect(currentTime(page)).toHaveText("00:00:01:00");
  await expect.poll(() => colourAt(page)).toBe("green");
});

test("plays in real time, pauses and stops at the end", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  // Pause once the playhead reaches the green second. Watching the clock rather
  // than screenshots means a slow screenshot can't miss the window.
  await expect(currentTime(page)).toHaveText(/^00:00:01:/, { timeout: 10_000 });
  await page.keyboard.press(" ");
  const paused = (await currentTime(page).textContent())!;
  await page.waitForTimeout(400);
  await expect(currentTime(page)).toHaveText(paused);
  await expect.poll(() => colourAt(page)).toBe(paused.startsWith("00:00:01:") ? "green" : "blue");

  await page.keyboard.press(" ");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 10_000 });
  await expect(currentTime(page)).toHaveText("00:00:03:00");
});

// Editing

test("splits at the playhead, and undo and redo restore each step", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 30);
  await page.keyboard.press("s");
  await expect(clips(page, "colors.mp4")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(clips(page, "colors.mp4")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(clips(page, "colors.mp4")).toHaveCount(2);
});

test("deleting from the main track closes the gap", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 30);
  await page.keyboard.press("s");
  await clips(page, "colors.mp4").first().click();
  await page.keyboard.press("Delete");
  await expect(duration(page)).toHaveText("00:00:02:00");
  await page.keyboard.press("Home");
  await expect.poll(() => colourAt(page)).toBe("green");
});

test("trims to the playhead from the keyboard", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 30);
  await page.keyboard.press("q");
  await expect(duration(page)).toHaveText("00:00:02:00");
  await expect(currentTime(page)).toHaveText("00:00:00:00");
  await expect.poll(() => colourAt(page)).toBe("green");

  await goToFrame(page, 30);
  await page.keyboard.press("w");
  await expect(duration(page)).toHaveText("00:00:01:00");
});

test("trims by dragging a clip's edge", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  const clip = clips(page, "colors.mp4");
  const box = (await clip.boundingBox())!;
  // Drag the right edge a third of the way back: 3 s becomes about 2 s.
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + (box.width * 2) / 3, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(duration(page)).toHaveText(/^00:00:0[12]:/);
  await page.keyboard.press("Control+z");
  await expect(duration(page)).toHaveText("00:00:03:00");
});

test("freezes a frame and pushes the rest of the clip later", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 45);
  await page.keyboard.press("f");
  await expect(duration(page)).toHaveText("00:00:06:00");
  // Three seconds in is inside the freeze, which holds the green frame.
  await goToFrame(page, 90);
  await expect.poll(() => colourAt(page)).toBe("green");
  await expect(page.getByRole("button", { name: "Detach audio" })).toBeDisabled();
});

test("detaches audio onto its own track", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await expect(tracks(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Detach audio" }).click();
  await expect(tracks(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Lock audio track" })).toBeVisible();
});

test("duplicates a clip right after itself", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.keyboard.press("Control+d");
  await expect(clips(page, "colors.mp4")).toHaveCount(2);
  await expect(duration(page)).toHaveText("00:00:06:00");
});

test("changes speed from the inspector", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.getByRole("radio", { name: "2×" }).click();
  await expect(duration(page)).toHaveText("00:00:01:15");
});

test("selects clips from the keyboard", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await page.keyboard.press("Escape");
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("Project");
  await clips(page, "colors.mp4").focus();
  await page.keyboard.press("Enter");
  await expect(clips(page, "colors.mp4")).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("colors.mp4");
});

test("adds and removes markers", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 30);
  await page.keyboard.press("m");
  await goToFrame(page, 0);
  await page.keyboard.press("ArrowDown");
  await expect(currentTime(page)).toHaveText("00:00:01:00");
});

// Layers

test("drags media above the main track to make an overlay", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await importMedia(page, FIXTURES.sticker);
  const tile = page.getByRole("listitem").filter({ hasText: "sticker.png" });
  const ruler = page.getByRole("region", { name: "Timeline" }).locator("canvas").first();
  const target = (await ruler.boundingBox())!;
  await tile.dragTo(ruler, { targetPosition: { x: 4, y: target.height / 2 } });
  await expect(tracks(page)).toHaveCount(2);

  // The drop lands a hair after zero, so look a few frames in.
  await goToFrame(page, 5);
  // The sticker's green circle covers the centre; its transparent corners show the red clip below.
  await expect.poll(() => colourAt(page, 0.5, 0.5)).toBe("green");
  await expect.poll(() => colourAt(page, 0.25, 0.06)).toBe("red");
  await expect.poll(() => colourAt(page, 0.1, 0.5)).toBe("red");
});

test("moves and scales a layer from the inspector", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.getByLabel("Scale value").fill("50");
  await page.getByLabel("Scale value").blur();
  await expect.poll(() => colourAt(page, 0.1, 0.1)).toBe("black");
  await expect.poll(() => colourAt(page, 0.5, 0.5)).toBe("red");
  await page.getByLabel("Position X value").fill("-30");
  await page.getByLabel("Position X value").blur();
  await expect.poll(() => colourAt(page, 0.5, 0.5)).toBe("black");
  await expect.poll(() => colourAt(page, 0.25, 0.5)).toBe("red");
});

test("fills a vertical canvas with a blurred background", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "9:16" }).click();
  await expect(page.getByText("1080 × 1920")).toBeVisible();
  await expect.poll(() => colourAt(page, 0.5, 0.1)).toBe("black");
  await page.getByRole("radio", { name: "Blur" }).click();
  await expect.poll(() => colourAt(page, 0.5, 0.1)).toBe("red");
});

test("shows phone footage upright using its rotation tag", async ({ page }) => {
  await addClip(page, FIXTURES.rotated);
  // Coded 640×360 with red on top; rotated 90° clockwise the top ends up on the right.
  await expect.poll(() => colourAt(page, 0.25, 0.5)).toBe("blue");
  await expect.poll(() => colourAt(page, 0.75, 0.5)).toBe("red");
});

test("plays animated GIF stickers in a loop", async ({ page }) => {
  await addClip(page, FIXTURES.animated);
  await expect(duration(page)).toHaveText("00:00:05:00");
  await expect.poll(() => colourAt(page)).toBe("green");
  await goToFrame(page, 16);
  await expect.poll(() => colourAt(page)).toBe("blue");
  await goToFrame(page, 31);
  await expect.poll(() => colourAt(page)).toBe("green");
});

// Audio

test("draws waveforms on clips with sound", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await expect(clips(page, "colors.mp4").locator("canvas[data-waveform]")).toHaveCount(1);
});

test("fades the sound in", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await setNumber(page, "Fade in", 1);
  const [start, middle] = await audioLevels(page, await exportVideo(page), [
    [0, 0.15],
    [1.5, 2],
  ]);
  expect(start!).toBeLessThan(middle! * 0.25);
  expect(middle!).toBeGreaterThan(0.05);
});

test("mutes and solos tracks in the export", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.getByRole("button", { name: "Detach audio" }).click();
  await page.getByRole("button", { name: "Solo main track" }).click();
  // The main track's video is silent once its sound is detached, so soloing it silences the export.
  const [soloedMain] = await audioLevels(page, await exportVideo(page, "solo-main.mp4"), [[0.5, 2.5]]);
  expect(soloedMain!).toBeLessThan(0.005);

  await page.getByRole("button", { name: "Unsolo main track" }).click();
  await page.getByRole("button", { name: "Mute audio track" }).click();
  const [muted] = await audioLevels(page, await exportVideo(page, "muted.mp4"), [[0.5, 2.5]]);
  expect(muted!).toBeLessThan(0.005);

  await page.getByRole("button", { name: "Unmute audio track" }).click();
  const [audible] = await audioLevels(page, await exportVideo(page, "audible.mp4"), [[0.5, 2.5]]);
  expect(audible!).toBeGreaterThan(0.05);
});

test("cleans up rumble, hum and hiss", async ({ page }) => {
  // Burst middles and gap middles from the third second of bursts on, once the hiss estimate has settled.
  const bursts = [6, 6.5, 7].map((t) => [t + 0.08, t + 0.22] as const);
  const gaps = [6, 6.5, 7].map((t) => [t + 0.35, t + 0.45] as const);
  const windows = [DIRTY.rumble, DIRTY.hum, ...bursts, ...gaps];

  await addClip(page, FIXTURES.dirty);
  const before = await audioLevels(page, await exportVideo(page, "dirty.mp4"), windows);

  await setNumber(page, "Reduce hiss", 100);
  await page.getByRole("radio", { name: "50 Hz" }).click();
  await page.getByLabel("Cut rumble").check();
  const after = await audioLevels(page, await exportVideo(page, "clean.mp4"), windows);

  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  expect(after[0]!).toBeLessThan(before[0]! * 0.25);
  expect(after[1]!).toBeLessThan(before[1]! * 0.1);
  expect(mean(after.slice(2, 5))).toBeGreaterThan(mean(before.slice(2, 5)) * 0.8);
  expect(mean(after.slice(5))).toBeLessThan(mean(before.slice(5)) * 0.4);
});

test("records a voiceover onto an audio track", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Record voiceover" }).click();
  await expect(page.getByRole("status", { name: "Recording voiceover" })).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByRole("button", { name: /^Voiceover 1.(webm|m4a),/ })).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Lock audio track" })).toBeVisible();
});

// Text

/**
 * Adds the "Boxed" preset (white text on a red box) with a single dot for
 * text, so the middle of the box is solid red and easy to check.
 */
async function addBoxedDot(page: Page) {
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByRole("button", { name: "Add Boxed text" }).click();
  const words = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(words).toBeFocused();
  await words.fill(".");
  await words.blur();
}

test("adds styled text and draws it on the canvas", async ({ page }) => {
  await expect.poll(() => colourAt(page)).toBe("black");
  await addBoxedDot(page);
  await expect(duration(page)).toHaveText("00:00:03:00");
  await expect(page.getByRole("button", { name: /^\., / })).toHaveCount(1);
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("fades text in", async ({ page }) => {
  await addBoxedDot(page);
  await page.getByLabel("In", { exact: true }).selectOption("fade");
  await setNumber(page, "In duration", 1);
  await page.keyboard.press("Home");
  await expect.poll(() => colourAt(page)).toBe("black");
  await goToFrame(page, 45);
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("exports text, drawn in the export worker", async ({ page }) => {
  await addBoxedDot(page);
  const exported = await exportVideo(page);
  await page.getByRole("button", { name: /^\., / }).click();
  await page.keyboard.press("Delete");
  await page.getByRole("tab", { name: "Media" }).click();
  await addClip(page, exported);
  await page.keyboard.press("Home");
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("imports .srt captions as text clips", async ({ page }) => {
  await importMedia(page, FIXTURES.captions);
  await expect(page.getByRole("button", { name: /^Hello there, 00:00:00:15 to 00:00:01:15/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Second line, 00:00:02:00 to 00:00:03:00/ })).toHaveCount(1);
  await expect(duration(page)).toHaveText("00:00:03:00");
});

test("imports a font and uses it for text", async ({ page }) => {
  await importMedia(page, FIXTURES.font);
  await page.getByRole("tab", { name: "Text" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: /^Brand Font/ })).toBeVisible();
  await page.getByRole("button", { name: "Add Title text" }).click();
  await page.getByLabel("Font", { exact: true }).selectOption("Brand Font");
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("Brand Font");
  await expect(errorNotice(page)).toHaveCount(0);
});

test("double-clicking text on the canvas edits its words", async ({ page }) => {
  await addBoxedDot(page);
  await page.getByRole("textbox", { name: "Text", exact: true }).blur();
  const box = (await preview(page).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toBeFocused();
});

// Looks

test("puts a transition on a cut, mixing both clips half-way through", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await addAgain(page, "colors.mp4");
  await expect(duration(page)).toHaveText("00:00:06:00");
  await page.getByRole("button", { name: "Add transition" }).click();
  await expect(page.getByRole("button", { name: "Fade transition, edit" })).toBeVisible();

  // Half a second centred on the cut at 3 s: blue holds, then fades into red.
  await goToFrame(page, 80);
  await expect.poll(() => colourAt(page)).toBe("blue");
  await goToFrame(page, 90);
  await expect
    .poll(async () => {
      const [r, g, b] = await rgbAt(page);
      return r > 80 && r < 180 && b > 80 && b < 180 && g < 60;
    })
    .toBe(true);
  await goToFrame(page, 100);
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("picks a transition from the library and sets its length", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await addAgain(page, "colors.mp4");
  await clips(page, "colors.mp4").first().click();
  await libraryTab(page, "Effects");
  await page.getByLabel("Search transitions").fill("circle");
  await page.getByRole("button", { name: "Circle open", exact: true }).hover();
  // Hovering plays the transition on the real renderer.
  await expect(page.getByRole("button", { name: "Circle open", exact: true }).locator("canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Circle open", exact: true }).click();
  await expect(page.getByLabel("Into next clip")).toHaveValue("CircleOpen");
  await expect(page.getByRole("button", { name: "Circle open transition, edit" })).toBeVisible();
  await setNumber(page, "Duration", 1);
  await expect(page.getByLabel("Duration value")).toHaveValue("1");
  await expect(errorNotice(page)).toHaveCount(0);
});

test("grades a clip from the Colour tab", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 15);
  await expect.poll(() => chromaAt(page)).toBeGreaterThan(150);
  await clipTab(page, "Colour");
  await setNumber(page, "Saturation", -100);
  await expect.poll(() => chromaAt(page)).toBeLessThan(12);
  await page.getByRole("button", { name: "Reset adjustments" }).click();
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("applies a built-in filter from the library", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 15);
  await libraryTab(page, "Effects");
  await page.getByRole("radio", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Mono", exact: true }).click();
  await expect.poll(() => chromaAt(page)).toBeLessThan(12);
  await clipTab(page, "Colour");
  await expect(page.getByLabel("Saturation value")).toHaveValue("-100");
});

test("grades with an imported .cube LUT", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await importMedia(page, FIXTURES.lut);
  await expect(page.getByRole("listitem").filter({ hasText: "Swap_Red_Blue.cube" })).toBeVisible();
  await goToFrame(page, 15);
  await clips(page, "colors.mp4").click();
  await clipTab(page, "Colour");
  await page.getByLabel("Lookup table").selectOption({ label: "Swap_Red_Blue" });
  await expect.poll(() => colourAt(page)).toBe("blue");
  await setNumber(page, "Intensity", 0);
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("keys out a green screen", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 45);
  await expect.poll(() => colourAt(page)).toBe("green");
  await clipTab(page, "Colour");
  await page.getByLabel("Remove a colour").check();
  await expect.poll(() => colourAt(page)).toBe("black");
  // Shortcuts ignore keys typed into a control, so leave the checkbox first.
  await page.getByLabel("Remove a colour").blur();
  // Red is nowhere near green, so it stays.
  await goToFrame(page, 15);
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("masks a clip to a circle, and inverts it", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 15);
  await clipTab(page, "Effects");
  await page.getByRole("radiogroup", { name: "Mask shape" }).getByRole("radio", { name: "Circle" }).click();
  await expect.poll(() => colourAt(page, 0.5, 0.5)).toBe("red");
  await expect.poll(() => colourAt(page, 0.04, 0.06)).toBe("black");
  await page.getByLabel("Invert").check();
  await expect.poll(() => colourAt(page, 0.5, 0.5)).toBe("black");
  await expect.poll(() => colourAt(page, 0.04, 0.06)).toBe("red");
});

test("blends an overlay with what's beneath it", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  const tile = page.getByRole("listitem").filter({ hasText: "colors.mp4" });
  const ruler = page.getByRole("region", { name: "Timeline" }).locator("canvas").first();
  const target = (await ruler.boundingBox())!;
  await tile.dragTo(ruler, { targetPosition: { x: 4, y: target.height / 2 } });
  await expect(tracks(page)).toHaveCount(2);

  // The overlay is the copy higher up the timeline.
  const tops = await clips(page, "colors.mp4").evaluateAll((elements) => elements.map((e) => e.getBoundingClientRect().top));
  await clips(page, "colors.mp4").nth(tops[0]! < tops[1]! ? 0 : 1).click();
  await goToFrame(page, 15);
  await clipTab(page, "Effects");
  // Red over the same red: difference cancels out, screen keeps it.
  await page.getByLabel("Blend mode").selectOption("difference");
  await expect.poll(() => colourAt(page)).toBe("black");
  await page.getByLabel("Blend mode").selectOption("screen");
  await expect.poll(() => colourAt(page)).toBe("red");
});

test("adds an effect from the library and tunes it in the inspector", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await libraryTab(page, "Effects");
  await page.getByRole("radio", { name: "Effects" }).click();
  await page.getByRole("button", { name: /^Glitch/ }).click();
  await expect(page.getByRole("button", { name: /^Glitch/ }).getByLabel("Added")).toBeVisible();
  await clipTab(page, "Effects");
  await expect(page.getByLabel("Glitch value")).toHaveValue("50");
  await page.getByLabel("Add effect").selectOption({ label: "Blur" });
  await expect(page.getByLabel("Blur value")).toHaveValue("50");
  await page.getByRole("button", { name: "Remove Glitch" }).click();
  await expect(page.getByLabel("Glitch value")).toHaveCount(0);
  await expect(errorNotice(page)).toHaveCount(0);
});

test("enhances a clip in one tap", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 15);
  await clipTab(page, "Enhance");
  // Auto colour reads the clip's thumbnails, so wait for them.
  await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();
  await page.getByRole("button", { name: "Enhance in one tap" }).click();
  await expect(page.getByLabel("Sharpen value")).toHaveValue("35");
  await expect(page.getByLabel("Upscale with FSR")).toBeChecked();
  await expect(page.getByText("On: black and white points set.")).toBeVisible();
  await expect.poll(() => colourAt(page)).toBe("red");
  await expect(errorNotice(page)).toHaveCount(0);
});

test("exports transitions and LUTs, drawn in the export worker", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await addAgain(page, "colors.mp4");
  await addAgain(page, "colors.mp4");
  await page.getByRole("button", { name: "Add transition" }).first().click();
  await importMedia(page, FIXTURES.lut);
  await clips(page, "colors.mp4").last().click();
  await clipTab(page, "Colour");
  await page.getByLabel("Lookup table").selectOption({ label: "Swap_Red_Blue" });
  const exported = await exportVideo(page);

  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await libraryTab(page, "Media");
  await addClip(page, exported);
  await expect(duration(page)).toHaveText("00:00:09:00");
  await goToFrame(page, 90);
  await expect
    .poll(async () => {
      const [r, g, b] = await rgbAt(page);
      return r > 80 && r < 180 && b > 80 && b < 180 && g < 60;
    })
    .toBe(true);
  // The third clip starts red, and the LUT turns it blue.
  await goToFrame(page, 195);
  await expect.poll(() => colourAt(page)).toBe("blue");
});

// Keyframes and animations

test("animates position with keyframes and eases between them", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await setNumber(page, "Scale", 50);
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Add Position X keyframe" }).click();
  await setNumber(page, "Position X", -30);
  await goToFrame(page, 60);
  // Once a value has keyframes, changing it elsewhere adds another.
  await setNumber(page, "Position X", 30);
  await expect(page.locator("[data-keyframe]")).toHaveCount(2);

  await goToFrame(page, 0);
  await expect.poll(() => colourAt(page, 0.2, 0.5)).toBe("red");
  await expect.poll(() => colourAt(page, 0.8, 0.5)).toBe("black");
  await goToFrame(page, 60);
  await expect.poll(() => colourAt(page, 0.8, 0.5)).toBe("blue");
  await expect.poll(() => colourAt(page, 0.2, 0.5)).toBe("black");
  await goToFrame(page, 30);
  await expect(page.getByLabel("Position X value")).toHaveValue("0");
  await expect.poll(() => colourAt(page, 0.5, 0.5)).toBe("green");

  // Hold the first position until the second keyframe arrives.
  await page.getByRole("button", { name: "Previous keyframe" }).click();
  await expect(currentTime(page)).toHaveText("00:00:00:00");
  await page.getByLabel("Easing to next").selectOption("hold");
  await page.getByLabel("Easing to next").blur();
  await page.getByRole("button", { name: "Next keyframe" }).click();
  await expect(currentTime(page)).toHaveText("00:00:02:00");
  await goToFrame(page, 30);
  await expect(page.getByLabel("Position X value")).toHaveValue("-30");
  await expect.poll(() => colourAt(page, 0.2, 0.5)).toBe("green");
});

test("removing the last keyframe keeps its value", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Add Opacity keyframe" }).click();
  await setNumber(page, "Opacity", 40);
  await page.getByRole("button", { name: "Remove Opacity keyframe" }).click();
  await expect(page.getByRole("button", { name: "Add Opacity keyframe" })).toBeVisible();
  await expect(page.locator("[data-keyframe]")).toHaveCount(0);
  await expect(page.getByLabel("Opacity value")).toHaveValue("40");
});

test("keyframes volume, and the export follows it", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Add Volume keyframe" }).click();
  await page.getByLabel("Easing to next").selectOption("hold");
  await page.getByLabel("Easing to next").blur();
  await goToFrame(page, 45);
  await setNumber(page, "Volume", 0);
  const [loud, quiet] = await audioLevels(page, await exportVideo(page), [
    [0.3, 1.2],
    [1.8, 2.7],
  ]);
  expect(loud!).toBeGreaterThan(0.05);
  expect(quiet!).toBeLessThan(loud! * 0.05);
});

test("fades a video clip in with an in animation", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.getByLabel("In", { exact: true }).selectOption("fade");
  await setNumber(page, "In duration", 1);
  await page.keyboard.press("Home");
  await expect.poll(() => colourAt(page)).toBe("black");
  await goToFrame(page, 45);
  await expect.poll(() => colourAt(page)).toBe("green");
});

// Speed curves and reverse

/** The timeline's length in seconds, read from the duration timecode at 30 fps. */
async function durationSeconds(page: Page): Promise<number> {
  const [hours, minutes, seconds, frames] = (await duration(page).textContent())!.split(":").map(Number);
  return hours! * 3600 + minutes! * 60 + seconds! + frames! / 30;
}

test("ramps speed with a curve preset, and goes back to normal", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.getByRole("radiogroup", { name: "Speed mode" }).getByRole("radio", { name: "Curve" }).click();
  await expect(duration(page)).toHaveText("00:00:03:00");
  // Hero slows to a fifth of normal speed in the middle, so the clip lasts longer.
  await page.getByRole("button", { name: "Hero" }).click();
  await expect.poll(() => durationSeconds(page)).toBeGreaterThan(3.5);
  await page.getByRole("radiogroup", { name: "Speed mode" }).getByRole("radio", { name: "Normal" }).click();
  await expect(duration(page)).toHaveText("00:00:03:00");
});

test("shapes a speed curve from the keyboard", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.getByRole("radiogroup", { name: "Speed mode" }).getByRole("radio", { name: "Curve" }).click();
  const middle = page.getByRole("slider", { name: "Speed point 2 of 3" });
  await middle.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(middle).toHaveAttribute("aria-valuetext", "2.14×");
  await expect.poll(() => durationSeconds(page)).toBeLessThan(2.5);
  // Arrows on a point change its speed, not the playhead.
  await expect(currentTime(page)).toHaveText("00:00:00:00");
});

test("blends frames for smooth slow motion", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await setNumber(page, "Speed", 0.25);
  await expect(duration(page)).toHaveText("00:00:12:00");
  // Frame 118 shows footage half-way between the last red frame and the first green one.
  await goToFrame(page, 118);
  await expect.poll(() => colourAt(page)).toBe("red");
  await page.getByLabel("Smooth slow motion").check();
  await page.getByLabel("Smooth slow motion").blur();
  await expect
    .poll(async () => {
      const [r, g, b] = await rgbAt(page);
      return r > 80 && g > 80 && b < 60;
    })
    .toBe(true);
});

test("reverses a clip in the background, and plays it forwards again", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await page.getByRole("button", { name: "Reverse", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Play forwards" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^colors\.mp4,/ }).getByLabel("Reversed")).toBeVisible();
  await expect(duration(page)).toHaveText("00:00:03:00");
  // Blue comes first now, red last.
  await goToFrame(page, 15);
  await expect.poll(() => colourAt(page)).toBe("blue");
  await goToFrame(page, 75);
  await expect.poll(() => colourAt(page)).toBe("red");
  // The reversed copy is Akira's own, so it isn't listed with the media.
  await expect(page.getByText("1 file", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play forwards" }).click();
  await expect.poll(() => colourAt(page)).toBe("blue");
  await goToFrame(page, 15);
  await expect.poll(() => colourAt(page)).toBe("red");
  // Reversing again reuses the copy, with no wait.
  await page.getByRole("button", { name: "Reverse", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Play forwards" })).toBeVisible();
  await expect.poll(() => colourAt(page)).toBe("blue");
  await expect(errorNotice(page)).toHaveCount(0);
});

// Stabilisation and motion tracking

/** Where the red in the preview is centred, as fractions of its width and height. */
async function redCentre(page: Page): Promise<[number, number]> {
  const png = await preview(page).screenshot();
  return page.evaluate(async (base64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let x = 0;
    let y = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 180 && data[i + 1]! < 80 && data[i + 2]! < 80) {
        const pixel = i / 4;
        x += pixel % image.width;
        y += Math.floor(pixel / image.width);
        count++;
      }
    }
    return [x / count / image.width, y / count / image.height] as [number, number];
  }, png.toString("base64"));
}

/** How far the red wanders across frames 10 to 20, as a fraction of the preview. */
async function redWander(page: Page): Promise<number> {
  await goToFrame(page, 10);
  const centres: [number, number][] = [];
  for (let frame = 10; frame <= 20; frame++) {
    await expect(currentTime(page)).toHaveText(`00:00:00:${String(frame).padStart(2, "0")}`);
    // Give the render worker a moment to draw the frame the clock shows, and wait for red to be on screen.
    await page.waitForTimeout(150);
    let centre: [number, number] = [Number.NaN, Number.NaN];
    await expect
      .poll(async () => {
        centre = await redCentre(page);
        return Number.isFinite(centre[0]);
      })
      .toBe(true);
    centres.push(centre);
    if (frame < 20) await stepFrames(page, 1);
  }
  const spread = (axis: 0 | 1) => Math.max(...centres.map((c) => c[axis])) - Math.min(...centres.map((c) => c[axis]));
  return Math.max(spread(0), spread(1));
}

test("stabilises shaky footage", async ({ page }) => {
  await addClip(page, FIXTURES.shaky);
  const before = await redWander(page);
  expect(before).toBeGreaterThan(0.02);
  await clipTab(page, "Enhance");
  await page.getByRole("button", { name: "Stabilise", exact: true }).click();
  await expect(page.getByLabel("Strength value")).toBeVisible({ timeout: 60_000 });
  await setNumber(page, "Strength", 100);
  const after = await redWander(page);
  expect(after).toBeLessThan(before / 3);
  await expect(errorNotice(page)).toHaveCount(0);
});

test("tracks a moving object and makes text follow it", async ({ page }) => {
  await addClip(page, FIXTURES.moving);
  await page.keyboard.press("Home");
  await addBoxedDot(page);
  await page.getByRole("textbox", { name: "Text", exact: true }).blur();
  await page.getByRole("button", { name: "Track an object" }).click();

  // The square starts at (120, 180) in a 640×360 video that fills the 1920×1080 canvas.
  const area = page.getByRole("application", { name: /Drag a box/ });
  const box = (await area.boundingBox())!;
  const scale = box.width / 1920;
  await page.mouse.move(box.x + 220 * scale, box.y + 400 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 500 * scale, box.y + 680 * scale, { steps: 4 });
  await page.mouse.up();

  await expect(page.locator("[data-keyframe]").first()).toBeVisible({ timeout: 60_000 });
  await expect(errorNotice(page)).toHaveCount(0);
  await page.keyboard.press("Home");
  const start = Number(await page.getByLabel("Position X value").inputValue());
  // By 1.5 s the square has moved 305 of the video's 640 pixels: 48% of the canvas.
  await goToFrame(page, 45);
  await expect
    .poll(async () => Number(await page.getByLabel("Position X value").inputValue()) - start)
    .toBeGreaterThan(42);
  expect(Number(await page.getByLabel("Position X value").inputValue()) - start).toBeLessThan(54);
});

// Saving

function saved(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /^Saved$/ });
}

/** Goes to the project list, waiting for the address too: Next can show a page before updating it. */
async function openProjects(page: Page) {
  await page.getByRole("link", { name: "All projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function nameProject(page: Page, name: string) {
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Project name").blur();
  await expect(saved(page)).toBeVisible();
}

test("saves as you edit, and reopens after a reload", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await nameProject(page, "Holiday cut");
  await expect(page).toHaveURL(/\/editor\?project=/);

  await page.reload();
  await page.getByLabel("Video preview").waitFor();
  await expect(page.getByLabel("Project name")).toHaveValue("Holiday cut");
  await expect(duration(page)).toHaveText("00:00:03:00");
  await expect(clips(page, "colors.mp4")).toHaveCount(1);
  await expect.poll(() => colourAt(page)).toBe("red");
  await expect(errorNotice(page)).toHaveCount(0);
});

test("doesn't save an empty project", async ({ page }) => {
  await openProjects(page);
  await expect(page.getByText("No projects yet")).toBeVisible();
});

test("lists saved projects, newest first, and opens them", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await nameProject(page, "First");
  await openProjects(page);
  await page.getByRole("link", { name: "New project" }).click();
  await page.getByLabel("Video preview").waitFor();
  await expect(duration(page)).toHaveText("00:00:00:00");
  await addClip(page, FIXTURES.sticker);
  await nameProject(page, "Second");

  await openProjects(page);
  await expect(page.getByRole("list", { name: "Projects" }).getByRole("heading")).toHaveText(["Second", "First"]);
  await page.getByRole("link", { name: "Open First" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("First");
  await expect(duration(page)).toHaveText("00:00:03:00");
});

test("deletes a project after asking", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await nameProject(page, "Scratch");
  await openProjects(page);
  await page.getByRole("button", { name: "Delete Scratch" }).click();
  await page.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByRole("heading", { name: "Scratch" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Scratch" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No projects yet")).toBeVisible();
});

test("downloads a project as .zip and imports it back, as a copy if it's still here", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await nameProject(page, "Trip");
  await openProjects(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Trip as .zip" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Trip.zip");
  const zip = test.info().outputPath("Trip.zip");
  await download.saveAs(zip);

  await page.getByRole("button", { name: "Delete Trip" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByLabel("Import project").setInputFiles(zip);
  await expect(page).toHaveURL(/\/editor\?project=/);
  const imported = page.url();
  await page.getByLabel("Video preview").waitFor();
  await expect(page.getByLabel("Project name")).toHaveValue("Trip");
  await expect(duration(page)).toHaveText("00:00:03:00");
  await expect.poll(() => colourAt(page)).toBe("red");

  await openProjects(page);
  await page.getByLabel("Import project").setInputFiles(zip);
  await expect(page).toHaveURL(/\/editor\?project=/);
  expect(page.url()).not.toBe(imported);
  await expect(page.getByLabel("Project name")).toHaveValue("Trip (copy)");
});

test("explains when a saved project can't be found", async ({ page }) => {
  await page.goto("/editor?project=missing");
  await expect(errorNotice(page)).toContainText("isn't saved in this browser");
  await expect(page).toHaveURL(/\/editor$/);
});

// Export

test("exports, and the export re-imports with the edited length", async ({ page }) => {
  await addClip(page, FIXTURES.colors);
  await goToFrame(page, 30);
  await page.keyboard.press("q");
  await expect(duration(page)).toHaveText("00:00:02:00");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("link", { name: "Download MP4" }).click({ timeout: 60_000 });
  const exported = test.info().outputPath("export.mp4");
  await (await downloadPromise).saveAs(exported);

  await page.getByRole("button", { name: /^colors\.mp4,/ }).click();
  await page.keyboard.press("Delete");
  await expect(duration(page)).toHaveText("00:00:00:00");
  await addClip(page, exported);
  await expect(duration(page)).toHaveText("00:00:02:00");
  await page.keyboard.press("Home");
  await expect.poll(() => colourAt(page)).toBe("green");
});

test("can cancel an export", async ({ page }) => {
  await addClip(page, FIXTURES.long);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Download MP4" })).toHaveCount(0);
  await expect(errorNotice(page)).toHaveCount(0);
});

test("explains when a file isn't media", async ({ page }) => {
  await importMedia(page, FIXTURES.notMedia);
  await expect(errorNotice(page)).toContainText("isn't a video or audio format");
});
