export type Rotation = 0 | 90 | 180 | 270;

/**
 * Maps a point on the displayed frame to the decoded texture, as a 3x3 matrix
 * in WebGL's column-major order. Both spaces run from (0, 0) at the top left to
 * (1, 1) at the bottom right.
 *
 * Phones record sideways and store a rotation for players to apply, then
 * optionally a horizontal flip (front cameras). The display is the texture
 * rotated clockwise, then flipped, so this undoes the flip and then the
 * rotation.
 */
export function textureTransform(rotation: Rotation, flip: boolean): Float32Array {
  // s = a*u + b*v + c and t = d*u + e*v + f, before the flip is undone.
  const [a, b, c, d, e, f] = ROTATIONS[rotation];
  // Undoing the flip replaces u with 1 - u.
  const [ua, uc, ud, uf] = flip ? [-a, a + c, -d, d + f] : [a, c, d, f];
  return new Float32Array([ua, ud, 0, b, e, 0, uc, uf, 1]);
}

const ROTATIONS: Record<Rotation, [number, number, number, number, number, number]> = {
  0: [1, 0, 0, 0, 1, 0],
  90: [0, 1, 0, -1, 0, 1],
  180: [-1, 0, 1, 0, -1, 1],
  270: [0, -1, 1, 1, 0, 0],
};

/** Applies a matrix from `textureTransform` to a display point. */
export function transformPoint(matrix: Float32Array, u: number, v: number): [number, number] {
  return [
    matrix[0]! * u + matrix[3]! * v + matrix[6]!,
    matrix[1]! * u + matrix[4]! * v + matrix[7]!,
  ];
}
