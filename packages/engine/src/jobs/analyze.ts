import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import type { CameraMotion } from "../project/model";
import { type Micros, microsToSeconds } from "../time";
import { goodFeatures } from "../vision/features";
import { flowLevels, trackPoints } from "../vision/flow";
import { type GrayImage, type Point, pyramid, toGray } from "../vision/image";
import { fitSimilarity } from "../vision/motion";
import { cameraPath, type FrameMotion, frameMotion } from "../vision/stabilize";
import { RegionTracker } from "../vision/track";
import { throwIfCancelled } from "./cancel";

/** Frames are measured at this size on their long side: plenty for motion, and quick. */
const ANALYSIS_SIZE = 480;
const PYRAMID_LEVELS = 3;

export interface AnalysisOptions {
  /** The part of the file to measure, in its own time. */
  start: Micros;
  end: Micros;
  signal?: AbortSignal;
  /** 0 to 1. */
  onProgress?: (progress: number) => void;
}

/**
 * Measures how the camera moved through part of a video, for stabilising:
 * corners in each frame are followed into the next, and the similarity
 * most of them agree on is the camera's movement between the two.
 */
export async function measureCameraMotion(file: Blob, options: AnalysisOptions): Promise<CameraMotion> {
  const times: Micros[] = [];
  const motions: FrameMotion[] = [];
  let previous: ReturnType<typeof flowLevels> | null = null;
  for await (const { time, image } of grayFrames(file, options)) {
    const levels = flowLevels(pyramid(image, PYRAMID_LEVELS));
    if (previous) motions.push(measureStep(previous, levels));
    times.push(time);
    previous = levels;
  }
  return { start: options.start, end: options.end, frames: cameraPath(times, motions) };
}

function measureStep(previous: ReturnType<typeof flowLevels>, next: ReturnType<typeof flowLevels>): FrameMotion {
  const { width, height } = previous[0]!.image;
  const points = goodFeatures(previous[0]!.image, { maxCount: 200, minDistance: 10 });
  const flows = trackPoints(previous, next, points);
  // Measured about the frame's centre, so rotation and zoom don't drag the movement along.
  const from: Point[] = [];
  const to: Point[] = [];
  flows.forEach((flow, i) => {
    if (!flow.found) return;
    from.push([points[i]![0] - width / 2, points[i]![1] - height / 2]);
    to.push([flow.point[0] - width / 2, flow.point[1] - height / 2]);
  });
  const fit = fitSimilarity(from, to, { threshold: 1.5 });
  // A frame with nothing to hold on to (a flash, a blank wall) counts as still.
  return fit ? frameMotion(fit.transform, width, height) : { x: 0, y: 0, angle: 0, logScale: 0 };
}

/** Where a tracked region is in one frame: its centre as fractions of the frame, and its size against the first. */
export interface TrackPoint {
  time: Micros;
  x: number;
  y: number;
  scale: number;
  /** False where the region was lost and holds its last known place. */
  found: boolean;
}

export interface TrackOptions extends AnalysisOptions {
  /** The region to follow in the first frame: centre and size as fractions of the frame. */
  region: { x: number; y: number; width: number; height: number };
}

/** Follows a region of a video from `start` to `end`, frame by frame. */
export async function trackRegion(file: Blob, options: TrackOptions): Promise<TrackPoint[]> {
  const points: TrackPoint[] = [];
  let tracker: RegionTracker | null = null;
  let firstWidth = 1;
  for await (const { time, image } of grayFrames(file, options)) {
    const levels = flowLevels(pyramid(image, PYRAMID_LEVELS));
    const { width, height } = image;
    if (!tracker) {
      const { region } = options;
      const box = { x: region.x * width, y: region.y * height, width: region.width * width, height: region.height * height };
      tracker = new RegionTracker(levels, box);
      firstWidth = box.width;
      points.push({ time, x: region.x, y: region.y, scale: 1, found: true });
      continue;
    }
    const box = tracker.next(levels);
    points.push({ time, x: box.x / width, y: box.y / height, scale: box.width / firstWidth, found: tracker.following });
  }
  return points;
}

/**
 * Decodes the range and yields each frame upright, small and grey. Frames
 * are closed as soon as they're drawn, which keeps the decoder's small pool
 * of frames free.
 */
async function* grayFrames(file: Blob, { start, end, signal, onProgress }: AnalysisOptions): AsyncGenerator<{ time: Micros; image: GrayImage }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error("This clip has no video Akira can measure.");
    const sink = new VideoSampleSink(track);
    let canvas: OffscreenCanvas | null = null;
    let context: OffscreenCanvasRenderingContext2D | null = null;
    for await (const sample of sink.samples(microsToSeconds(start), microsToSeconds(end))) {
      let frame: { time: Micros; image: GrayImage };
      try {
        throwIfCancelled(signal, "Measuring was cancelled.");
        const fit = ANALYSIS_SIZE / Math.max(sample.displayWidth, sample.displayHeight);
        const width = Math.max(16, Math.round(sample.displayWidth * Math.min(1, fit)));
        const height = Math.max(16, Math.round(sample.displayHeight * Math.min(1, fit)));
        if (!canvas || canvas.width !== width || canvas.height !== height) {
          canvas = new OffscreenCanvas(width, height);
          context = canvas.getContext("2d", { willReadFrequently: true })!;
        }
        // Draw the way it's shown: rotated as the file says, then flipped.
        const sideways = sample.rotation === 90 || sample.rotation === 270;
        context!.save();
        context!.translate(width / 2, height / 2);
        if (sample.flip) context!.scale(-1, 1);
        context!.rotate((sample.rotation * Math.PI) / 180);
        const drawWidth = sideways ? height : width;
        const drawHeight = sideways ? width : height;
        context!.drawImage(sample.toCanvasImageSource(), -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        context!.restore();
        const time = Math.max(start, sample.microsecondTimestamp);
        frame = { time, image: toGray(context!.getImageData(0, 0, width, height).data, width, height) };
      } finally {
        // Closed before anything else happens, so the decoder can reuse it.
        sample.close();
      }
      onProgress?.((frame.time - start) / Math.max(1, end - start));
      yield frame;
    }
  } finally {
    input.dispose();
  }
}
