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

/**
 * What the simulation collides against: a rectangular floor from -halfX to
 * +halfX on X and -halfZ to +halfZ on Z, walled all round, plus cover boxes.
 * Every `MapDef` (maps/) is one. There is no "current arena": every physics
 * function takes it as a parameter, since one server runs several rooms.
 */
export interface Arena {
  halfX: number;
  halfZ: number;
  obstacles: readonly Box[];
}

export const WALL_HEIGHT = 1.4;
export const WALL_THICKNESS = 0.6;
