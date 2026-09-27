// Bastion: a hill fort at noon. In the middle, the Keep: a brick square with
// four offset doors round a crate Vault. Around it the Ring, a 5 m corridor
// you can run round forever, then a broken Rampart with two gates per side,
// then the open Field with a bunker in each corner.
//
// One quarter is authored (north-west, plus the north side) and rotated four
// times; each quarter's outer works wear different props (QUARTERS).
//
// Plan (per axis, metres from the centre): Keep 0..7, Ring 7..12, Rampart
// 12..13, Field 13..30.
import { box, type Obstacle, type ObstacleKind } from "../types.ts";
import type { FfaMapDef } from "./index.ts";

const H = 30;

/** Rotation by a quarter turn, `k` times: (x, z) -> (-z, x). NW -> NE -> SE -> SW. */
function rot(b: Obstacle, k: number): Obstacle {
  let { x, z, w, d } = b;
  for (let i = 0; i < k; i++) [x, z, w, d] = [-z + 0, x, d, w];
  return { ...b, x, z, w, d };
}

/** Each quarter's dressing: authored kind -> kind in that quarter. The Keep stays brick everywhere. */
const QUARTERS: Partial<Record<ObstacleKind, ObstacleKind>>[] = [
  {}, // North: sandbags and crates.
  { sandbags: "barrier" }, // East: concrete.
  { crate: "barrels" }, // South: fuel.
  { sandbags: "barrier", crate: "container" }, // West: supply dump.
];

const QUARTER: Obstacle[] = [
  // Keep, north wall (pinwheel: each side owns its left corner), door x -5..-2.
  box("wall", -6, -6.5, 2, 1, 1.3),
  box("wall", 2, -6.5, 8, 1, 1.3),

  // Ring: a small crate stack in each corner, so you can't see round it.
  box("crate", -9.5, -9.5, 1.5, 1.5, 1.4),

  // Rampart, north side: three pieces, gates at x -8..-5 and 3..6.
  box("sandbags", -10.5, -12.5, 5, 1, 1.2),
  box("sandbags", -1, -12.5, 8, 1, 1.2),
  box("sandbags", 9, -12.5, 6, 1, 1.2),

  // Field: barrels off the rampart corner, the corner bunker and its sandbag wing.
  box("barrels", -16, -16, 2, 2, 1.1),
  box("container", -23, -23, 3, 3, 1.8),
  box("sandbags", -18, -25, 1, 4, 1.2),
  // North field: a trench line, a crate pile, barrels, a barrier.
  box("sandbags", -2, -21, 6, 1, 1.2),
  box("crate", 6, -24, 2, 2, 1.4),
  box("barrels", -9, -18, 1.5, 1.5, 1.1),
  box("barrier", 15, -21, 1, 3, 1.2),
  box("crate", -25, -10, 2, 2, 1.4),
];

const OBSTACLES: Obstacle[] = [
  // The Vault: the crate pile in the middle of the Keep.
  box("crate", 0, 0, 3, 3, 1.5),
  ...QUARTERS.flatMap((skin, k) => QUARTER.map((b) => rot({ ...b, kind: skin[b.kind] ?? b.kind }, k))),
];

// Four spawns per quarter: behind the trench line, off the rampart-corner
// barrels, in the bunker's corner, and in the Ring by a keep door.
const SPAWN_QUARTER = [
  { x: -1.5, z: -22.5 },
  { x: -21.5, z: -16.5 },
  { x: -25.5, z: -26.5 },
  { x: -11.5, z: -4.5 },
];

export const BASTION: FfaMapDef = {
  id: "bastion",
  name: "Bastion",
  blurb: "A hill fort at noon: a keep in the middle, a ring to run round it, a broken rampart and open fields outside.",
  mode: "ffa",
  players: { min: 3, max: 6 },
  halfX: H,
  halfZ: H,
  symmetry: "point",
  obstacles: OBSTACLES,
  spawns: [0, 1, 2, 3].flatMap((k) =>
    SPAWN_QUARTER.map((s) => {
      const r = rot(box("crate", s.x, s.z, 1, 1, 1), k);
      return { x: r.x, z: r.z };
    }),
  ),
  hub: { x: 0, z: 0 },
  // Team deathmatch: the west half (North and West fields, rotations 0 and 3)
  // against the east half (East and South fields, rotations 1 and 2).
  teams: [
    { name: "West", spawns: [0, 1, 2, 3, 12, 13, 14, 15] },
    { name: "East", spawns: [4, 5, 6, 7, 8, 9, 10, 11] },
  ],
  zones: [
    { id: "keep", name: "Keep", x0: -7, z0: -7, x1: 7, z1: 7, tint: 0xa2503c },
    { id: "ring", name: "Ring", x0: -12, z0: -12, x1: 12, z1: 12, tint: 0xd8c9a8 },
    { id: "north", name: "North Field", x0: -30, z0: -30, x1: 13, z1: -13, tint: 0xcdb57a },
    { id: "east", name: "East Field", x0: 13, z0: -30, x1: 30, z1: 13, tint: 0xa7a9a3 },
    { id: "south", name: "South Field", x0: -13, z0: 13, x1: 30, z1: 30, tint: 0xc8453a },
    { id: "west", name: "West Field", x0: -30, z0: -13, x1: -13, z1: 30, tint: 0x4f7fb3 },
    { id: "rampart", name: "Rampart", x0: -13, z0: -13, x1: 13, z1: 13, tint: 0x9a8a60 },
  ],
  landmarks: [
    { name: "Keep", x: 0, z: 0 },
    { name: "NW Bunker", x: -23, z: -23 },
    { name: "NE Bunker", x: 23, z: -23 },
    { name: "SE Bunker", x: 23, z: 23 },
    { name: "SW Bunker", x: -23, z: 23 },
  ],
  decor: [],
  theme: {
    floor: 0x9a9160,
    grid: 0xaaa070,
    gridOpacity: 0.16,
    outerFloor: 0x6f7a44,
    background: 0x9fc4d8,
    wall: "sandbags",
    hemiSky: 0xeaf4ff,
    hemiGround: 0x5a5a38,
    hemiIntensity: 1.2,
    sun: 0xfff4dc,
    sunIntensity: 2.4,
    sunDir: { x: 8, y: 30, z: 6 },
  },
  favours: ["rifle", "shotgun", "sniper"],
};
