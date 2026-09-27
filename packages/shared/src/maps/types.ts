// Map format. A map is plain data: the simulation only needs the bounds and
// the obstacle boxes (every box blocks movement and bullets, grenades fly
// over them); everything else is for the renderer or for matchmaking.
//
// Coordinates follow arena.ts: the sim is 2D on the ground plane, `x` is world
// X and `z` is world Z, the origin is the centre of the arena. The iso camera
// looks down the (-1, -1, -1) diagonal, so on screen "up" is the -x/-z corner,
// "right" is +x/-z, and a box hides what lies just behind it towards -x/-z.

import type { Box } from "../arena.ts";

/**
 * What an obstacle looks like. Collision is the same for every kind (a full
 * box); the kind only picks the prop the client dresses it with:
 *
 * - `crate`: a grid of `Crate`s (with a `CardboardBoxes_1` on big stacks).
 *   Squarish blocks, 1-4 m a side.
 * - `barrier`: `Barrier_Single` concrete jersey barriers tiled along the long
 *   side. Long thin cover.
 * - `sandbags`: `SackTrench_Small` tiled along the long side. Long thin cover,
 *   the lowest-looking kind.
 * - `container`: one `Container_Small` stretched to the footprint. The only
 *   tall kind (2 m); use it for big blocks that are meant to break sight.
 * - `wall`: `BrickWall_2` tiled along the long side, like the outer walls.
 * - `barrels`: `ExplodingBarrel`s packed on the footprint (decorative, they do
 *   not explode). Small squarish cover, about 1-2 m a side.
 */
export type ObstacleKind = "crate" | "barrier" | "sandbags" | "container" | "wall" | "barrels";

export interface Obstacle extends Box {
  kind: ObstacleKind;
}

/** Flat props: safe anywhere, they never look like cover. */
export const FLAT_DECOR = [
  "Debris_Papers_1",
  "Debris_Papers_2",
  "Debris_Papers_3",
  "Debris_Pile",
  "Pallet",
  "Pallet_Broken",
  "WoodPlanks",
] as const;
/** Tall props: only outside the walls, where a player can't stand behind them. */
export const TALL_DECOR = [
  "TrafficCone",
  "Debris_Tires",
  "ExplodingBarrel",
  "CardboardBoxes_1",
  "CardboardBoxes_2",
  "CardboardBoxes_4",
] as const;
export type DecorProp = (typeof FLAT_DECOR)[number] | (typeof TALL_DECOR)[number];

/** A prop with no collision, placed as-is (native size times `scale`). */
export interface Decor {
  prop: DecorProp;
  x: number;
  z: number;
  /** Rotation around Y, radians. */
  yaw: number;
  /** Uniform scale, default 1. */
  scale?: number;
}

/** Prop tiled along the outer walls. All of them stay low enough (<= 1.4 m) not to hide a player. */
export type WallStyle = "brick" | "barrier" | "sandbags";

/** Colours are 0xRRGGBB numbers, like three.js takes them. */
export interface MapTheme {
  /** Arena floor. */
  floor: number;
  /** Faint 2 m grid over the floor. */
  grid: number;
  gridOpacity: number;
  /** Ground outside the walls. */
  outerFloor: number;
  /** Scene clear colour. */
  background: number;
  wall: WallStyle;
  /** HemisphereLight sky / ground colours and intensity. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** DirectionalLight (casts the shadows). `sunDir` points from the ground to the sun. */
  sun: number;
  sunIntensity: number;
  sunDir: { x: number; y: number; z: number };
}

export type WeaponTag = "rifle" | "shotgun" | "sniper" | "smg";

/**
 * - `point`: 180 degree rotation around the origin, (x, z) -> (-x, -z).
 * - `mirrorDiag`: reflection across the x = z line, (x, z) -> (z, x). That
 *   line is the vertical axis of the screen, so the map is a left/right mirror
 *   on screen and the camera sees both halves the same way (occlusion is fair
 *   too, which point symmetry only approximates).
 */
export type Symmetry = "point" | "mirrorDiag";

export interface Spawn {
  x: number;
  z: number;
}

export interface MapDef {
  /** Stable id, sent over the wire (`mapId`). Lowercase, no spaces. */
  id: string;
  name: string;
  /** One line for the loading screen / HUD. */
  blurb: string;
  /** The floor spans [-halfX, halfX] x [-halfZ, halfZ]. */
  halfX: number;
  halfZ: number;
  symmetry: Symmetry;
  obstacles: readonly Obstacle[];
  /**
   * Spawns, in mirrored pairs: `spawns[2k + 1]` is the mirror image of
   * `spawns[2k]`. Slot 0 starts a match on `spawns[0]`, slot 1 on `spawns[1]`;
   * respawns may use any of them (arena.ts's "farthest from the opponent").
   */
  spawns: readonly Spawn[];
  decor: readonly Decor[];
  theme: MapTheme;
  /** Weapons the layout rewards, for the design notes and a future map card. */
  favours: readonly WeaponTag[];
}

// --- Authoring helpers --------------------------------------------------------

/** The mirror image of a point under a map's symmetry. */
export function mirrorPoint(s: Symmetry, x: number, z: number): Spawn {
  return s === "point" ? { x: -x + 0, z: -z + 0 } : { x: z, z: x };
}

/** The mirror image of an obstacle under a map's symmetry. */
export function mirrorBox(s: Symmetry, b: Obstacle): Obstacle {
  const p = mirrorPoint(s, b.x, b.z);
  return s === "point" ? { ...b, x: p.x, z: p.z } : { ...b, x: p.x, z: p.z, w: b.d, d: b.w };
}

function same(a: Obstacle, b: Obstacle): boolean {
  return a.x === b.x && a.z === b.z && a.w === b.w && a.d === b.d;
}

/** Kind swaps applied to the mirrored half, to dress twin boxes differently. */
export type Reskin = Partial<Record<ObstacleKind, ObstacleKind>>;

/**
 * Authors write one half of the map; this adds the mirror image of every box
 * (a box that is its own mirror, e.g. centred on the origin, is kept once).
 * `reskin` changes the kind of the mirrored copies only: the collision (and
 * the height, which matters for the camera) stays symmetric, the look doesn't.
 */
export function symmetric(s: Symmetry, half: readonly Obstacle[], reskin: Reskin = {}): Obstacle[] {
  const out: Obstacle[] = [];
  for (const b of half) {
    out.push(b);
    const m = mirrorBox(s, b);
    if (!same(m, b)) out.push({ ...m, kind: reskin[b.kind] ?? b.kind });
  }
  return out;
}

/** `[a, mirror(a), b, mirror(b), ...]` from `[a, b, ...]`. */
export function spawnPairs(s: Symmetry, firsts: readonly Spawn[]): Spawn[] {
  return firsts.flatMap((p) => [p, mirrorPoint(s, p.x, p.z)]);
}

/** Shorthand for an obstacle: centre, footprint, height, kind. */
export function box(kind: ObstacleKind, x: number, z: number, w: number, d: number, h: number): Obstacle {
  return { kind, x, z, w, d, h };
}

export type AsciiLegend = Readonly<Record<string, { kind: ObstacleKind; h: number }>>;

/**
 * Point-symmetric layout from ASCII art. `top` is the top half of the floor
 * (rows of -z first), one character per `cell` metres: `.` is floor, any
 * legend character is cover. Runs of the same character are merged into as
 * few boxes as possible (row runs first), then the half is rotated 180
 * degrees to make the other half (see `symmetric` for `reskin`).
 */
export function asciiPoint(
  halfX: number,
  halfZ: number,
  top: readonly string[],
  legend: AsciiLegend,
  opts: { cell?: number; reskin?: Reskin } = {},
): Obstacle[] {
  const cell = opts.cell ?? 1;
  const cols = Math.round((2 * halfX) / cell);
  const rows = Math.round(halfZ / cell);
  if (top.length !== rows) throw new Error(`asciiPoint: ${top.length} rows, expected ${rows}`);
  top.forEach((r, j) => {
    if (r.length !== cols) throw new Error(`asciiPoint: row ${j} has ${r.length} chars, expected ${cols}`);
  });
  const used = top.map((r) => Array.from(r, () => false));
  const out: Obstacle[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const ch = top[j][i];
      if (ch === "." || used[j][i]) continue;
      const def = legend[ch];
      if (!def) throw new Error(`asciiPoint: unknown character "${ch}" at row ${j}, col ${i}`);
      let w = 1;
      while (i + w < cols && top[j][i + w] === ch && !used[j][i + w]) w++;
      let d = 1;
      const rowOk = (jj: number) => {
        for (let k = i; k < i + w; k++) if (top[jj][k] !== ch || used[jj][k]) return false;
        return true;
      };
      while (j + d < rows && rowOk(j + d)) d++;
      for (let jj = j; jj < j + d; jj++) for (let k = i; k < i + w; k++) used[jj][k] = true;
      out.push(box(def.kind, -halfX + (i + w / 2) * cell, -halfZ + (j + d / 2) * cell, w * cell, d * cell, def.h));
    }
  return symmetric("point", out, opts.reskin);
}
