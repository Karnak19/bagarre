// Arena layout. The simulation is 2D on the ground plane: `x` is world X,
// `z` is world Z. Y (up) only exists for rendering.

export interface Box {
  /** Centre X. */
  x: number;
  /** Centre Z. */
  z: number;
  /** Full width along X. */
  w: number;
  /** Full depth along Z. */
  d: number;
  /** Visual height. */
  h: number;
}

/** The floor is a square from -ARENA_HALF to +ARENA_HALF on both axes. */
export const ARENA_HALF = 15;
export const WALL_HEIGHT = 1.4;
export const WALL_THICKNESS = 0.6;

/**
 * Cover. The layout is point-symmetric around the origin, so neither spawn
 * side has an advantage.
 */
export const OBSTACLES: readonly Box[] = [
  { x: 0, z: 0, w: 3, d: 3, h: 1.8 },
  { x: -7, z: -4, w: 1, d: 5, h: 1.6 },
  { x: 7, z: 4, w: 1, d: 5, h: 1.6 },
  { x: -4, z: 8, w: 5, d: 1, h: 1.6 },
  { x: 4, z: -8, w: 5, d: 1, h: 1.6 },
  { x: -9.5, z: 9.5, w: 2, d: 2, h: 1.2 },
  { x: 9.5, z: -9.5, w: 2, d: 2, h: 1.2 },
];

export const SPAWN_POINTS: readonly { x: number; z: number }[] = [
  { x: -12, z: -12 },
  { x: 12, z: 12 },
  { x: -12, z: 12 },
  { x: 12, z: -12 },
];
