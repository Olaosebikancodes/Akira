import { goodFeatures } from "./features";
import { type FlowLevel, trackPoints } from "./flow";
import type { Point } from "./image";
import { applySimilarity, fitSimilarity } from "./motion";

/** A tracked region: its centre and size in pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fewer points than this and the region's features are found afresh. */
const MIN_POINTS = 10;
/** Points that don't come back to where they started within this many pixels are dropped. */
const ROUND_TRIP = 1;

/**
 * Follows a region from frame to frame: finds corners inside it, follows
 * them with optical flow, keeps only those that survive a round trip, and
 * moves and scales the region by the similarity they agree on.
 */
export class RegionTracker {
  private points: Point[];
  private previous: FlowLevel[];
  box: Box;
  /** False once the region couldn't be followed; it then stays where it was last seen. */
  following = true;

  constructor(first: FlowLevel[], box: Box) {
    this.previous = first;
    this.box = box;
    this.points = this.findPoints(first);
  }

  /** Moves the region onto the next frame and returns where it is. */
  next(levels: FlowLevel[]): Box {
    if (this.points.length < MIN_POINTS) this.points = this.findPoints(this.previous);
    const forward = trackPoints(this.previous, levels, this.points);
    const back = trackPoints(
      levels,
      this.previous,
      forward.map((result) => result.point),
    );
    const from: Point[] = [];
    const to: Point[] = [];
    forward.forEach((result, i) => {
      const returned = back[i]!;
      const start = this.points[i]!;
      const drift = Math.hypot(returned.point[0] - start[0], returned.point[1] - start[1]);
      if (result.found && returned.found && drift < ROUND_TRIP) {
        from.push(start);
        to.push(result.point);
      }
    });

    const fit = fitSimilarity(from, to, { threshold: 2 });
    this.previous = levels;
    if (!fit || fit.inliers < 4) {
      this.following = false;
      this.points = [];
      return this.box;
    }
    this.following = true;
    const [x, y] = applySimilarity(fit.transform, [this.box.x, this.box.y]);
    const scale = Math.hypot(fit.transform.a, fit.transform.b);
    this.box = { x, y, width: this.box.width * scale, height: this.box.height * scale };
    this.points = to;
    return this.box;
  }

  private findPoints(levels: FlowLevel[]): Point[] {
    const { x, y, width, height } = this.box;
    const shortest = Math.min(width, height);
    return goodFeatures(levels[0]!.image, {
      region: [x - width / 2, y - height / 2, width, height],
      maxCount: 80,
      minDistance: Math.max(3, shortest / 12),
      quality: 0.02,
    });
  }
}
