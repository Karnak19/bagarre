// Crossroads: a shelled town where two roads cross. The middle is a big open
// Square around a clock tower (the rifle and sniper ground); around it, four
// quarters of ruined buildings with narrow lanes (the shotgun and SMG
// ground), and an alley along the town wall that loops round everything.
//
// One quarter is authored (the north-west one) and rotated four times, so
// every quarter plays the same; each rotation is dressed with its own props
// (see QUARTERS), so each quarter looks different from the Square.
//
// Plan (per axis, metres from the centre): Square 0..9, buildings 4.5..25,
// alley 25..30. The roads run from the Square to the alley between the
// quarters, |x| or |z| < 4.5.
import { box, type Obstacle, type ObstacleKind } from "../types.ts";
import type { FfaMapDef } from "./index.ts";

const H = 30;

/** Rotation by a quarter turn, `k` times: (x, z) -> (-z, x). NW -> NE -> SE -> SW. */
function rot(b: Obstacle, k: number): Obstacle {
  let { x, z, w, d } = b;
  for (let i = 0; i < k; i++) [x, z, w, d] = [-z + 0, x, d, w];
  return { ...b, x, z, w, d };
}

/** Each quarter's dressing: authored kind -> kind in that quarter. */
const QUARTERS: Partial<Record<ObstacleKind, ObstacleKind>>[] = [
  {}, // NW Chapel: brick walls, crates.
  { wall: "barrier", crate: "container" }, // NE Depot: concrete barriers, containers.
  { wall: "sandbags", crate: "barrels" }, // SE Barracks: sandbags, fuel barrels.
  { wall: "barrier" }, // SW Market: concrete barriers, crate stalls.
];

// The north-west quarter, plus the west half of the north road and a quarter
// of the Square. Walls are 1.2 m (every quarter's wall kind reads right at
// that height), props 1.4 m.
const QUARTER: Obstacle[] = [
  // Chapel: a roofless ruin, four walls and three gaps, an altar inside.
  box("wall", -21, -24.5, 8, 1, 1.2),
  box("wall", -24.5, -20.5, 1, 7, 1.2),
  box("wall", -14.5, -20.75, 1, 6.5, 1.2),
  box("wall", -18.5, -14.5, 7, 1, 1.2),
  box("crate", -19, -19.5, 2, 2, 1.4),

  // Row house along the north road: two offset walls make a long hall that
  // runs from the alley to the corner of the Square.
  box("wall", -10, -20, 1, 10, 1.2),
  box("wall", -5, -12.5, 1, 7, 1.2),
  box("wall", -8.5, -24.5, 2, 1, 1.2),
  box("wall", -6.5, -9.5, 2, 1, 1.2),

  // Row house along the west road: the same, mirrored across the diagonal.
  box("wall", -20, -10, 10, 1, 1.2),
  box("wall", -12.5, -5, 7, 1, 1.2),
  box("wall", -24.5, -8.5, 1, 2, 1.2),
  box("wall", -9.5, -6.5, 1, 2, 1.2),

  // North alley: a crate chicane between the Chapel and the row house.
  box("crate", -14, -28.5, 2, 3, 1.4),
  box("crate", -10, -26, 2, 2, 1.4),

  // Square: a stall and a sandbag line, a dash from the tower.
  box("crate", -5, -5, 2, 2, 1.4),
  box("sandbags", -7.5, 0, 1, 3, 1.1),
];

const OBSTACLES: Obstacle[] = [
  // The clock tower, the landmark you see from every road.
  box("container", 0, 0, 3, 3, 1.8),
  ...QUARTERS.flatMap((skin, k) => QUARTER.map((b) => rot({ ...b, kind: skin[b.kind] ?? b.kind }, k))),
];

// Four spawns per quarter: the west road by the row house, the north alley
// between the crate piles, the alley corner, and inside the Chapel.
const SPAWN_QUARTER = [
  { x: -12.5, z: -3.5 },
  { x: -12.5, z: -25.5 },
  { x: -26.5, z: -24.5 },
  { x: -22.5, z: -16.5 },
];

export const CROSSROADS: FfaMapDef = {
  id: "crossroads",
  name: "Crossroads",
  blurb: "A shelled town where two roads meet: a wide square round the clock tower, ruins and alleys all around.",
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
  // Team deathmatch: the west half (Chapel and Market quarters, spawns of
  // rotations 0 and 3) against the east half (Depot and Barracks, rotations 1
  // and 2). Each is the other turned half a turn.
  teams: [
    { name: "West", spawns: [0, 1, 2, 3, 12, 13, 14, 15] },
    { name: "East", spawns: [4, 5, 6, 7, 8, 9, 10, 11] },
  ],
  zones: [
    { id: "square", name: "Square", x0: -12, z0: -12, x1: 12, z1: 12, tint: 0xd8c9a8 },
    { id: "chapel", name: "Chapel", x0: -30, z0: -30, x1: -4.5, z1: -4.5, tint: 0xa2503c },
    { id: "depot", name: "Depot", x0: 4.5, z0: -30, x1: 30, z1: -4.5, tint: 0x4f7fb3 },
    { id: "barracks", name: "Barracks", x0: 4.5, z0: 4.5, x1: 30, z1: 30, tint: 0xcdb57a },
    { id: "market", name: "Market", x0: -30, z0: 4.5, x1: -4.5, z1: 30, tint: 0xb9823f },
    { id: "north", name: "North Road", x0: -4.5, z0: -30, x1: 4.5, z1: -12, tint: 0x8c8c8c },
    { id: "east", name: "East Road", x0: 12, z0: -4.5, x1: 30, z1: 4.5, tint: 0x8c8c8c },
    { id: "south", name: "South Road", x0: -4.5, z0: 12, x1: 4.5, z1: 30, tint: 0x8c8c8c },
    { id: "west", name: "West Road", x0: -30, z0: -4.5, x1: -12, z1: 4.5, tint: 0x8c8c8c },
  ],
  landmarks: [
    { name: "Clock Tower", x: 0, z: 0 },
    { name: "Chapel", x: -19.5, z: -19.5 },
    { name: "Depot", x: 19.5, z: -19.5 },
    { name: "Barracks", x: 19.5, z: 19.5 },
    { name: "Market", x: -19.5, z: 19.5 },
  ],
  decor: [],
  theme: {
    floor: 0x8a7d6a,
    grid: 0x9c8f7a,
    gridOpacity: 0.18,
    outerFloor: 0x5d5446,
    background: 0x2a2620,
    wall: "brick",
    hemiSky: 0xfff1d6,
    hemiGround: 0x4a4034,
    hemiIntensity: 1.1,
    sun: 0xffe0b0,
    sunIntensity: 2.2,
    sunDir: { x: 14, y: 26, z: 8 },
  },
  favours: ["rifle", "sniper", "shotgun"],
};
