import {
  type Asset,
  type Clip,
  clipAt,
  type LayerGeometry,
  layerGeometry,
  type Micros,
  type Project,
} from "@akira/engine";

/** Size of an asset's picture as displayed; null for audio. */
export function pictureSize(asset: Asset): { width: number; height: number } | null {
  return asset.video ?? asset.image ?? null;
}

export interface VisibleLayer {
  clip: Clip;
  geometry: LayerGeometry;
}

/** The clips on screen at `time`, bottom to top, with where each sits on the canvas. */
export function visibleLayers(project: Project, time: Micros): VisibleLayer[] {
  const layers: VisibleLayer[] = [];
  for (const track of project.tracks) {
    if (track.kind !== "video" || track.hidden) continue;
    const clip = clipAt(track, time);
    const size = clip && pictureSize(project.assets[clip.assetId]!);
    if (!clip || !size) continue;
    layers.push({
      clip,
      geometry: layerGeometry({
        displayWidth: size.width,
        displayHeight: size.height,
        // The file's own rotation is already in the display size; it only affects sampling.
        rotation: 0,
        flip: false,
        transform: clip.transform,
        crop: clip.crop,
        canvasWidth: project.canvas.width,
        canvasHeight: project.canvas.height,
      }),
    });
  }
  return layers;
}
