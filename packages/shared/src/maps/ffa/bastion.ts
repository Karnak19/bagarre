// Bastion: a hill fort at noon. In the middle, the Keep: an irregular brick
// hall with five doors round a crate Vault, and a broken north-east corner
// that opens onto a small Breach yard. Around it the Ring, a corridor you can
// run round forever (wider on the north, where the Breach is), then a broken
// Rampart whose sides each have their own gates (sandbags north and south,
// concrete east and west, and a jutting outwork at the north-west corner),
// then four Fields that are each built differently:
//
// - North: the Trenches, long staggered sandbag lines (rifle cover).
// - West: the Supply Dump, tall containers you weave between.
// - East: the Checkpoint, a few long concrete barriers on open ground.
// - South: the Fuel Depot, a dense patch of barrels and crate stacks.
//
// Nothing is mirrored; the validator measures the spawns and the two team
// sides against each other. The West team's containers throw more camera
// shadow; the East side answers with crate stacks, which are also over 1.2 m. Plan (metres from the centre): Keep about
// -8..6 on x and -6..7 on z, Ring to the Rampart at about 12-14, Fields to 30.
import { box, type Obstacle } from "../types.ts";
import type { FfaMapDef } from "./index.ts";

const H = 30;

const KEEP: Obstacle[] = [
  // North wall, door at x -6..-4.
  box("wall", -7, -5.5, 2, 1, 1.3),
  box("wall", -2, -5.5, 4, 1, 1.3),
  // The Breach: the north-east corner is knocked in. A stub down to a door
  // (z -4..-2), then the yard's south wall.
  box("wall", 0.5, -5, 1, 2, 1.3),
  box("wall", 3, -1.5, 6, 1, 1.3),
  // East wall, door at z 3..5.
  box("wall", 5.5, 1, 1, 4, 1.3),
  box("wall", 5.5, 6, 1, 2, 1.3),
  // South wall, door at x -1..1.
  box("wall", -4.5, 6.5, 7, 1, 1.3),
  box("wall", 3, 6.5, 4, 1, 1.3),
  // West wall, door at z -1..1.
  box("wall", -7.5, -3, 1, 4, 1.3),
  box("wall", -7.5, 3.5, 1, 5, 1.3),
  // The Vault, off-centre, and barrels in the Breach yard.
  box("crate", -2.5, 2.5, 3, 3, 1.5),
  box("barrels", 3.5, -4.5, 1.5, 1, 1.1),
];

const RING: Obstacle[] = [
  box("crate", -10.5, -9.5, 1.5, 1.5, 1.4),
  box("sandbags", 8.5, 9, 1, 2, 1.2),
  box("crate", 8.5, -3, 1.5, 1.5, 1.4),
  box("barrels", -10.5, 2, 1.7, 1.5, 1.1),
];

const RAMPART: Obstacle[] = [
  // North (sandbags), gates at x -9..-7 and 2..5. The west piece is pushed
  // out 2 m: the Outwork, a pocket over the north-west Ring corner.
  box("sandbags", -11, -14.5, 4, 1, 1.2),
  box("sandbags", -2.5, -12.5, 9, 1, 1.2),
  box("sandbags", 8.5, -12.5, 7, 1, 1.2),
  // East (concrete), gates at z -8..-6, 1..3, 8..10.
  box("barrier", 11.5, -10, 1, 4, 1.2),
  box("barrier", 11.5, -2.5, 1, 7, 1.2),
  box("barrier", 11.5, 5.5, 1, 5, 1.2),
  box("barrier", 11.5, 11, 1, 2, 1.2),
  // South (sandbags), gates at x -5..-2 and 6..8.
  box("sandbags", -9.5, 12.5, 9, 1, 1.2),
  box("sandbags", 2, 12.5, 8, 1, 1.2),
  box("sandbags", 10, 12.5, 4, 1, 1.2),
  // West (concrete), gates at z -8..-5 and 4..6; the north piece closes the Outwork.
  box("barrier", -13.5, -11.5, 1, 7, 1.2),
  box("barrier", -13.5, -0.5, 1, 9, 1.2),
  box("barrier", -13.5, 9, 1, 6, 1.2),
];

const FIELDS: Obstacle[] = [
  // North: the Trenches.
  box("sandbags", -8, -17.5, 8, 1, 1.2),
  box("sandbags", 3, -21.5, 6, 1, 1.2),
  box("sandbags", -12, -25.5, 6, 1, 1.2),
  box("crate", -27, -21.5, 2, 1.5, 1.4),
  box("crate", -3, -24, 2, 2, 1.4),
  box("crate", 9, -16.5, 2, 1.5, 1.4),
  box("barrels", -17, -19, 1.5, 1.5, 1.1),
  box("barrels", 6, -27, 2, 1, 1.1),
  // NW Bunker.
  box("container", -22, -24, 4, 2, 1.8),
  box("sandbags", -20, -27.5, 3, 1, 1.2),
  // West: the Supply Dump.
  box("container", -19, -6, 2, 5, 1.8),
  box("container", -25, -1, 4, 2, 1.8),
  box("container", -20, 5, 3, 2, 1.8),
  box("container", -26, 10, 2, 4, 1.8),
  // SW emplacement.
  box("sandbags", -22, 20, 6, 1, 1.2),
  box("barrels", -15.5, 16, 1.5, 1.5, 1.1),
  box("crate", -19, 15, 2, 1.5, 1.4),
  box("sandbags", -25.5, 23, 1, 5, 1.2),
  box("crate", -17, 26, 2, 2, 1.4),
  // East: the Checkpoint.
  box("barrier", 20, -3, 1, 7, 1.2),
  box("barrier", 24, 4, 4, 1, 1.2),
  box("barrier", 25, -9, 1, 6, 1.2),
  box("crate", 20, 8, 2, 2, 1.4),
  // NE Tower.
  box("crate", 23, -22, 3, 3, 1.4),
  box("barrier", 18, -26, 4, 1, 1.2),
  box("barrels", 14.5, -18.5, 1.5, 1.5, 1.1),
  box("crate", 19, -10, 2, 2, 1.4),
  box("crate", 15, -14.5, 1.5, 1.5, 1.4),
  // South: the Fuel Depot.
  box("barrels", -6, 18, 2, 2, 1.1),
  box("barrels", -3, 25, 2, 1.5, 1.1),
  box("crate", 3, 19, 2, 3, 1.4),
  box("barrels", 8, 24, 1.5, 1.5, 1.1),
  box("sandbags", -10, 22, 1, 4, 1.2),
  // SE Stacks.
  box("crate", 22, 22, 3, 2, 1.4),
  box("barrels", 26, 17, 1.5, 1.5, 1.1),
  box("barrels", 16, 20, 1.5, 1.5, 1.1),
  box("sandbags", 18, 27, 5, 1, 1.2),
  box("crate", 15, 13, 2, 2, 1.4),
  box("crate", 10.5, 19.5, 2, 2, 1.4),
  box("barrier", 21, 13.5, 4, 1, 1.2),
];

const OBSTACLES: Obstacle[] = [...KEEP, ...RING, ...RAMPART, ...FIELDS];

// 0-3 north, 4-7 east, 8-11 south, 12-15 west (the last of each four is in the Ring).
const SPAWNS = [
  { x: 1.5, z: -24.5 },
  { x: -16, z: -21 },
  { x: -25.5, z: -26 },
  { x: -10.5, z: -3 },
  { x: 23, z: -4 },
  { x: 13.5, z: -16 },
  { x: 24.5, z: -26.5 },
  { x: 8, z: -9 },
  { x: 0, z: 24.5 },
  { x: 17.5, z: 17.5 },
  { x: 25, z: 23 },
  { x: 9.5, z: 4 },
  { x: -21.5, z: 2.5 },
  { x: -19.5, z: 17.5 },
  { x: -23.5, z: 24.5 },
  { x: -9, z: 10 },
];

export const BASTION: FfaMapDef = {
  id: "bastion",
  name: "Bastion",
  blurb: "A hill fort at noon: a broken keep in the middle, a ring round it, a rampart, and four fields each built its own way.",
  mode: "ffa",
  players: { min: 3, max: 6 },
  halfX: H,
  halfZ: H,
  obstacles: OBSTACLES,
  spawns: SPAWNS,
  hub: { x: 0, z: 0 },
  // Team deathmatch: the west half (North and West fields) against the east
  // half (East and South fields).
  teams: [
    { name: "West", spawns: [0, 1, 2, 3, 12, 13, 14, 15] },
    { name: "East", spawns: [4, 5, 6, 7, 8, 9, 10, 11] },
  ],
  zones: [
    { id: "keep", name: "Keep", x0: -8, z0: -6, x1: 6, z1: 7, tint: 0xa2503c },
    { id: "ring", name: "Ring", x0: -13, z0: -12, x1: 11, z1: 12, tint: 0xd8c9a8 },
    { id: "north", name: "Trenches", x0: -30, z0: -30, x1: 13, z1: -13, tint: 0xcdb57a },
    { id: "east", name: "Checkpoint", x0: 12, z0: -30, x1: 30, z1: 13, tint: 0xa7a9a3 },
    { id: "south", name: "Fuel Depot", x0: -14, z0: 13, x1: 30, z1: 30, tint: 0xc8453a },
    { id: "west", name: "Supply Dump", x0: -30, z0: -13, x1: -14, z1: 30, tint: 0x4f7fb3 },
    { id: "rampart", name: "Rampart", x0: -14, z0: -13, x1: 12, z1: 13, tint: 0x9a8a60 },
  ],
  landmarks: [
    { name: "Keep", x: 0, z: 0 },
    { name: "Vault", x: -2.5, z: 2.5 },
    { name: "Outwork", x: -11, z: -13 },
    { name: "Breach", x: 3, z: -4 },
    { name: "NW Bunker", x: -22, z: -24 },
    { name: "NE Tower", x: 23, z: -22 },
    { name: "SE Stacks", x: 22, z: 22 },
    { name: "SW Emplacement", x: -22, z: 22 },
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
