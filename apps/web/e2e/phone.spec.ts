import { expect, type Locator, type Page, test } from "@playwright/test";
import { ensureFixtures, FIXTURES } from "./fixtures";
import { colourAt, preview, rgbAt } from "./preview";

type Point = { x: number; y: number };

// A phone held upright: about an iPhone's size, driven by touch.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await ensureFixtures(page);
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await page.goto("/editor");
  await preview(page).waitFor();
});

// Helpers

function tool(page: Page, name: string): Locator {
  return page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name, exact: true });
}

function sheet(page: Page, name: string): Locator {
  return page.getByRole("dialog", { name });
}

function clip(page: Page): Locator {
  return page.getByRole("button", { name: /^colors\.mp4,/ });
}

function currentTime(page: Page): Locator {
  return page.getByLabel("Current time");
}

async function addClip(page: Page) {
  await tool(page, "Media").tap();
  await page.getByLabel("Import", { exact: true }).setInputFiles([FIXTURES.colors]);
  await page.getByRole("button", { name: "Add colors.mp4 to timeline" }).tap();
  await expect(clip(page)).toHaveCount(1);
}

async function centre(locator: Locator): Promise<Point> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Real touches, sent the way the browser receives them from a screen, so it
 * scrolls and pinches natively rather than seeing only synthetic events.
 * Each step lists the fingers down at that moment.
 */
async function touch(page: Page, steps: Point[][]) {
  const cdp = await page.context().newCDPSession(page);
  for (const [index, fingers] of steps.entries()) {
    const type = index === 0 ? "touchStart" : "touchMove";
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: fingers.map((point, id) => ({ ...point, id })) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** One finger dragged from `from` to `to`. */
async function swipe(page: Page, from: Point, to: Point) {
  const steps = Array.from({ length: 13 }, (_, i) => [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }]);
  await touch(page, steps);
}

/** Two fingers either side of `at`, moving from `fromGap` to `toGap` pixels apart. */
async function pinch(page: Page, at: Point, fromGap: number, toGap: number) {
  const steps = Array.from({ length: 13 }, (_, i) => {
    const gap = fromGap + ((toGap - fromGap) * i) / 12;
    return [
      { x: at.x - gap / 2, y: at.y },
      { x: at.x + gap / 2, y: at.y },
    ];
  });
  await touch(page, steps);
}

// Layout

test("fits a phone with the preview, the timeline and tools along the bottom", async ({ page }) => {
  await expect(preview(page)).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeInViewport();
  await expect(page.getByText("Tap Media below to add a clip.")).toBeVisible();
  // Nothing pokes out sideways, and the desktop tour stays away.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("adds media from the Media sheet, which then gets out of the way, and plays", async ({ page }) => {
  await tool(page, "Media").tap();
  await expect(sheet(page, "Media")).toBeVisible();
  await expect(tool(page, "Media")).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Import", { exact: true }).setInputFiles([FIXTURES.colors]);
  await page.getByRole("button", { name: "Add colors.mp4 to timeline" }).tap();

  await expect(sheet(page, "Media")).toBeHidden();
  await expect(clip(page)).toHaveCount(1);
  await expect.poll(() => colourAt(page)).toBe("red");

  await page.getByRole("button", { name: "Play" }).tap();
  await expect(currentTime(page)).toHaveText(/^00:00:01:/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Pause" }).tap();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

// Timeline by touch

test("a tap selects a clip, a tap beside it lets go, and a swipe scrolls instead", async ({ page }) => {
  await addClip(page);
  const box = (await clip(page).boundingBox())!;
  const lane = { x: box.x + box.width + 40, y: box.y + box.height / 2 };

  // Tapping the empty lane drops the selection and moves the playhead there.
  await page.touchscreen.tap(lane.x, lane.y);
  await expect(clip(page)).toHaveAttribute("aria-pressed", "false");
  await expect(currentTime(page)).not.toHaveText("00:00:00:00");

  await page.touchscreen.tap(box.x + box.width / 2, lane.y);
  await expect(clip(page)).toHaveAttribute("aria-pressed", "true");
  await page.touchscreen.tap(lane.x, lane.y);
  await expect(clip(page)).toHaveAttribute("aria-pressed", "false");

  // Pinching apart zooms the timeline in around the fingers...
  await pinch(page, await centre(clip(page)), 60, 240);
  await expect.poll(async () => (await clip(page).boundingBox())!.width).toBeGreaterThan(box.width * 2.5);
  await expect(clip(page)).toHaveAttribute("aria-pressed", "false");

  // ...and a swipe across the unselected clip scrolls the timeline without picking it up.
  const before = (await clip(page).boundingBox())!.x;
  await swipe(page, { x: 330, y: lane.y }, { x: 90, y: lane.y });
  await expect.poll(async () => (await clip(page).boundingBox())!.x).toBeLessThan(before - 100);
  await expect(clip(page)).toHaveAttribute("aria-pressed", "false");
  await expect(clip(page)).toHaveAccessibleName(/^colors\.mp4, 00:00:00:00 to/);
});

// Sheets

test("Edit and Effects open over the timeline, leaving the preview in view", async ({ page }) => {
  await addClip(page);
  await clip(page).tap();
  await tool(page, "Edit").tap();
  const edit = sheet(page, "Edit");
  await expect(edit.getByRole("tablist", { name: "Clip settings" })).toBeVisible();
  const canvas = (await preview(page).boundingBox())!;
  expect((await edit.boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);

  // Another tool swaps the sheet rather than stacking a second one.
  await tool(page, "Effects").tap();
  await expect(edit).toBeHidden();
  await sheet(page, "Effects").getByRole("radio", { name: "Filters" }).tap();
  await page.getByRole("button", { name: "Mono", exact: true }).tap();
  await expect
    .poll(async () => {
      const rgb = await rgbAt(page);
      return Math.max(...rgb) - Math.min(...rgb);
    })
    .toBeLessThan(12);

  await page.getByRole("button", { name: "Close effects" }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("adding text opens its settings so the words can be typed", async ({ page }) => {
  await tool(page, "Text").tap();
  await page.getByRole("button", { name: "Add Title text" }).tap();
  await expect(sheet(page, "Text")).toBeHidden();
  const words = sheet(page, "Edit").getByRole("textbox", { name: "Text", exact: true });
  await words.fill("Hello phone");
  await expect(page.getByRole("button", { name: /^Hello phone,/ })).toHaveCount(1);
});

// Changing size

test("turning to a wide screen brings the desktop layout with the same project", async ({ page }) => {
  await addClip(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("tablist", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tools" })).toHaveCount(0);
  await expect(clip(page)).toHaveCount(1);
  await expect.poll(() => colourAt(page)).toBe("red");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(() => colourAt(page)).toBe("red");
});
