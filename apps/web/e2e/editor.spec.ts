import { expect, type Page, test } from "@playwright/test";
import { ensureFixtures, FIXTURES } from "./fixtures";

type Colour = "red" | "green" | "blue" | "other";
type Spot = "centre" | "left" | "right";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await ensureFixtures(page);
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
});

async function importClip(page: Page, file: string) {
  await page.getByLabel("Import video").setInputFiles(file);
}

/** The dominant colour at a spot in the preview, read from what's on screen. */
async function previewColour(page: Page, spot: Spot = "centre"): Promise<Colour> {
  const png = await page.locator("canvas").screenshot();
  const [r, g, b] = await page.evaluate(
    async ({ base64, spot }) => {
      const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
      const image = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const x = { centre: 0.5, left: 0.25, right: 0.75 }[spot] * image.width;
      return [...ctx.getImageData(Math.floor(x), Math.floor(image.height / 2), 1, 1).data];
    },
    { base64: png.toString("base64"), spot },
  );
  if (r! > 150 && g! < 100 && b! < 100) return "red";
  if (g! > 150 && r! < 100 && b! < 100) return "green";
  if (b! > 150 && r! < 100 && g! < 100) return "blue";
  return "other";
}

/** Our error message. Scoped to main: Next.js keeps an empty route announcer alert on every page. */
function errorMessage(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

function currentTime(page: Page) {
  return page.getByLabel("Current time");
}

async function stepFrames(page: Page, count: number) {
  const key = count < 0 ? "ArrowLeft" : "ArrowRight";
  for (let i = 0; i < Math.abs(count); i++) await page.keyboard.press(key);
}

test("imports a video and shows its first frame", async ({ page }) => {
  await importClip(page, FIXTURES.colors);
  await expect(page.getByLabel("Duration")).toHaveText("00:00:03:00");
  await expect(page.getByText("640×360 · 30.00 fps · 48 kHz audio")).toBeVisible();
  await expect.poll(() => previewColour(page)).toBe("red");
});

test("steps frame by frame and lands on the exact frame", async ({ page }) => {
  await importClip(page, FIXTURES.colors);
  await expect(page.getByLabel("Duration")).toHaveText("00:00:03:00");

  await stepFrames(page, 29);
  await expect(currentTime(page)).toHaveText("00:00:00:29");
  await expect.poll(() => previewColour(page)).toBe("red");

  await stepFrames(page, 1);
  await expect(currentTime(page)).toHaveText("00:00:01:00");
  await expect.poll(() => previewColour(page)).toBe("green");

  await stepFrames(page, -1);
  await expect.poll(() => previewColour(page)).toBe("red");
});

test("scrubs to any point on the timeline", async ({ page }) => {
  await importClip(page, FIXTURES.colors);
  const playhead = page.getByLabel("Playhead");
  await expect(playhead).toBeEnabled();
  await playhead.fill("2500000");
  await expect(currentTime(page)).toHaveText("00:00:02:15");
  await expect.poll(() => previewColour(page)).toBe("blue");
});

test("plays, advances in real time and pauses", async ({ page }) => {
  await importClip(page, FIXTURES.colors);
  await expect(page.getByLabel("Duration")).toHaveText("00:00:03:00");

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect.poll(() => previewColour(page), { timeout: 5_000 }).toBe("green");

  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await currentTime(page).textContent();
  await page.waitForTimeout(500);
  await expect(currentTime(page)).toHaveText(paused!);

  // Playing to the end stops on the last frame.
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 5_000 });
  await expect(currentTime(page)).toHaveText("00:00:03:00");
  await expect.poll(() => previewColour(page)).toBe("blue");
});

test("trims, exports, and the export re-imports with the trimmed length", async ({ page }) => {
  await importClip(page, FIXTURES.colors);
  await expect(page.getByLabel("Duration")).toHaveText("00:00:03:00");

  await stepFrames(page, 30);
  await page.getByRole("button", { name: "Set in point" }).click();
  await expect(page.getByLabel("In point")).toHaveText("00:00:01:00");
  await expect(page.getByLabel("Duration")).toHaveText("00:00:02:00");
  await expect.poll(() => previewColour(page)).toBe("green");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4" }).click();
  await page.getByRole("link", { name: "Download MP4" }).click({ timeout: 60_000 });
  const download = await downloadPromise;
  const exported = test.info().outputPath("export.mp4");
  await download.saveAs(exported);

  await importClip(page, exported);
  await expect(page.getByLabel("Duration")).toHaveText("00:00:02:00");
  await expect(page.getByText("640×360 · 30.00 fps · 48 kHz audio")).toBeVisible();
  await expect.poll(() => previewColour(page)).toBe("green");

  await stepFrames(page, 30);
  await expect.poll(() => previewColour(page)).toBe("blue");
});

test("can cancel an export", async ({ page }) => {
  await importClip(page, FIXTURES.long);
  await expect(page.getByLabel("Duration")).toHaveText("00:00:20:00");
  await page.getByRole("button", { name: "Export MP4" }).click();
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect(page.getByRole("button", { name: "Export MP4" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Download MP4" })).toHaveCount(0);
  await expect(errorMessage(page)).toHaveCount(0);
});

test("shows phone footage upright using its rotation tag", async ({ page }) => {
  await importClip(page, FIXTURES.rotated);
  // Coded 640×360 with red on top; rotated 90° clockwise the top ends up on the right.
  await expect(page.getByText("360×640")).toBeVisible();
  await expect.poll(() => previewColour(page, "left")).toBe("blue");
  await expect.poll(() => previewColour(page, "right")).toBe("red");
});

test("explains when a file isn't media", async ({ page }) => {
  await importClip(page, FIXTURES.notMedia);
  await expect(errorMessage(page)).toContainText("isn't a video or audio format");
});
