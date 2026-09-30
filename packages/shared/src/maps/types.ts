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
 *
 * Added with Ironvale (the client falls back to the older prop in brackets
 * when props.glb has no such node):
 *
 * - `dumpster`: one `TrashContainer` stretched to the footprint. About
 *   2.4 x 1.3 m, 1.35 m tall; up to 2 m only as a compact block. [container]
 * - `rock`: snowy boulders (`Rock_Snow_4`, `_6`, `_7`) on a ~1.6 m grid, the
 *   shape of each picked from its position, so a long box is a row of rocks,
 *   not one stretched rock. About 1.1-1.4 m tall. [crate]
 * - `wagon`: one `Container_Long` (a long shipping container, the rail
 *   wagons) stretched to the footprint. Tall (1.8 m) like `container`, so
 *   only as a compact block. [container]
 * - `trench`: the full-size `SackTrench` tiled along the long side. Long thin
 *   cover like `sandbags`, a little bulkier. [sandbags]
 * - `gastank`: upright `GasTank`s (1 m a side) packed on the footprint, like
 *   `barrels`. [barrels]
 * - `tank`: one `WaterTank_Floor` (a tank lying on the ground) stretched to
 *   the footprint, long side along the box's. Keep it 1.3-1.4 m tall. [container]
 */
export type ObstacleKind = "crate" | "barrier" | "sandbags" | "container" | "wall" | "barrels" | "dumpster" | "rock" | "wagon" | "trench" | "gastank" | "tank";

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
/**
 * Tall props: only outside the walls, where a player can't stand behind them.
 * The trees (Ultimate Nature Pack, about 2.2-3.6 m tall at scale 1, placed at
 * scale 2) are tall enough to hide the floor from the iso camera when they
 * stand just outside the +x or +z wall: keep them on the -x / -z sides, or far
 * out (royale/royale-maps.test.ts measures it).
 */
export const TALL_DECOR = [
  "TrafficCone",
  "Debris_Tires",
  "ExplodingBarrel",
  "CardboardBoxes_1",
  "CardboardBoxes_2",
  "CardboardBoxes_4",
  "PineTree_Snow_1",
  "PineTree_Snow_2",
  "PineTree_Snow_3",
  "PineTree_Snow_4",
  "PineTree_Snow_5",
  "CommonTree_Dead_Snow_1",
  "CommonTree_Dead_Snow_2",
  "CommonTree_Dead_Snow_3",
  "CommonTree_Dead_Snow_4",
  "CommonTree_Dead_Snow_5",
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

export interface Spawn {
  x: number;
  z: number;
}

/**
 * What a map needs to host a battle royale. Optional on a MapDef, required on
 * a RoyaleMapDef (maps/royale/): only the maps in ROYALE_MAPS carry it.
 */
export interface RoyaleMapData {
  /**
   * Where a crate stands at the start of every match: open floor, never on
   * or next to a spawn (src/royale.test.ts keeps them 3 m from every
   * spawn and clear of cover).
   */
  crates: readonly Spawn[];
  /** The rectangle the zone's final centre is drawn in (`pickZone`), world metres. */
  zone: { x0: number; z0: number; x1: number; z1: number };
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
  obstacles: readonly Obstacle[];
  /**
   * Spawns, in balanced pairs: `spawns[2k]` and `spawns[2k + 1]` face each
   * other and must be equally good starts (the validator measures it, see
   * scripts/analyze.ts `fairness`); they need not be mirror images. Slot 0
   * starts a match on `spawns[0]`, slot 1 on `spawns[1]`: that pair is held to
   * the strictest tolerances. Respawns may use any spawn (sight.ts's
   * `respawnPoint`: out of the opponent's sight first, then farthest), so the
   * later pairs are respawn spots and are held to looser ones.
   */
  spawns: readonly Spawn[];
  decor: readonly Decor[];
  theme: MapTheme;
  /** Weapons the layout rewards, for the design notes and a future map card. */
  favours: readonly WeaponTag[];
  /** Battle royale: crate spots and zone limits. Absent: not a royale map. */
  royale?: RoyaleMapData;
}

// --- Authoring helpers --------------------------------------------------------

/** Shorthand for an obstacle: centre, footprint, height, kind. */
export function box(kind: ObstacleKind, x: number, z: number, w: number, d: number, h: number): Obstacle {
  return { kind, x, z, w, d, h };
}

export type AsciiLegend = Readonly<Record<string, { kind: ObstacleKind; h: number }>>;

/**
 * Boxes from ASCII art of the whole floor. `art` rows go from -z (the top of the
 * plan) to +z, characters from -x to +x, one character per `cell` metres
 * (default 1), so there are `2 * halfZ / cell` rows of `2 * halfX / cell`
 * characters. `.` is floor; any legend character is cover. Runs of the same
 * character are merged into as few boxes as possible (row runs first, then
 * grown down while the rows below match). Nothing is mirrored: what is drawn
 * is the map.
 */
export function ascii(halfX: number, halfZ: number, art: readonly string[], legend: AsciiLegend, opts: { cell?: number } = {}): Obstacle[] {
  const cell = opts.cell ?? 1;
  const cols = Math.round((2 * halfX) / cell);
  const rows = Math.round((2 * halfZ) / cell);
  if (art.length !== rows) throw new Error(`ascii: ${art.length} rows, expected ${rows}`);
  art.forEach((r, j) => {
    if (r.length !== cols) throw new Error(`ascii: row ${j} has ${r.length} chars, expected ${cols}`);
  });
  const used = art.map((r) => Array.from(r, () => false));
  const out: Obstacle[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const ch = art[j][i];
      if (ch === "." || used[j][i]) continue;
      const def = legend[ch];
      if (!def) throw new Error(`ascii: unknown character "${ch}" at row ${j}, col ${i}`);
      let w = 1;
      while (i + w < cols && art[j][i + w] === ch && !used[j][i + w]) w++;
      let d = 1;
      const rowOk = (jj: number) => {
        for (let k = i; k < i + w; k++) if (art[jj][k] !== ch || used[jj][k]) return false;
        return true;
      };
      while (j + d < rows && rowOk(j + d)) d++;
      for (let jj = j; jj < j + d; jj++) for (let k = i; k < i + w; k++) used[jj][k] = true;
      out.push(box(def.kind, -halfX + (i + w / 2) * cell, -halfZ + (j + d / 2) * cell, w * cell, d * cell, def.h));
    }
  return out;
}
