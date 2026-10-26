import type { Locator, Page } from "@playwright/test";

export type Colour = "red" | "green" | "blue" | "black" | "other";

export function preview(page: Page): Locator {
  return page.getByLabel("Video preview");
}

/** The dominant colour at a point in the preview, as fractions of its width and height. */
export async function colourAt(page: Page, x = 0.5, y = 0.5): Promise<Colour> {
  const [r, g, b] = await rgbAt(page, x, y);
  if (r > 150 && g < 100 && b < 100) return "red";
  if (g > 150 && r < 100 && b < 100) return "green";
  if (b > 150 && r < 100 && g < 100) return "blue";
  if (r < 30 && g < 30 && b < 30) return "black";
  return "other";
}

/** The exact colour at a point in the preview, 0-255 per channel. */
export async function rgbAt(page: Page, x = 0.5, y = 0.5): Promise<[number, number, number]> {
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
