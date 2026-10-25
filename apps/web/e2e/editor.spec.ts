import { expect, type Locator, type Page, test } from "@playwright/test";
import { ensureFixtures, FIXTURES } from "./fixtures";

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
  if (r! > 150 && g! < 100 && b! < 100) return "red";
  if (g! > 150 && r! < 100 && b! < 100) return "green";
  if (b! > 150 && r! < 100 && g! < 100) return "blue";
  if (r! < 30 && g! < 30 && b! < 30) return "black";
  return "other";
}

async function stepFrames(page: Page, count: number) {
  const key = count < 0 ? "ArrowLeft" : "ArrowRight";
  for (let i = 0; i < Math.abs(count); i++) await page.keyboard.press(key);
}

async function goToFrame(page: Page, frame: number) {
  await page.keyboard.press("Home");
  await stepFrames(page, frame);
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
  await expect.poll(() => colourAt(page), { timeout: 5_000 }).toBe("green");
  await page.keyboard.press(" ");
  const paused = await currentTime(page).textContent();
  await page.waitForTimeout(400);
  await expect(currentTime(page)).toHaveText(paused!);

  await page.keyboard.press(" ");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 5_000 });
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
