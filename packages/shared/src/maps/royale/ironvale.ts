// Ironvale: an abandoned mining town in the snow, under an overcast winter
// sky. In the middle, the Headframe: the mine shaft tower (one tall container
// block) in a walled compound, with four crates to fight over early. Four
// roads run out to the edge as clear lanes with cover only along their
// edges. Round the compound the Ring Road stays open, except for four small
// walled yards (one per quarter) that give any final circle some cover.
// Eight districts round the ring, each built from its own kind of prop; five
// are dense, with 2-3 m lanes (shotgun and SMG ground):
//
// - North: the Rail Sidings, three lines of container wagons along x, cargo between them.
// - North-east: the Engine Shed, a brick shed with three doors round a locomotive.
// - East: Main Street, brick houses either side of a zigzag street.
// - South-east: the Slag Heaps, a maze of crate stacks and barrels.
// - South: Workers' Row, two rows of brick huts.
// - South-west: the Fuel Yard, tanks and packed barrel clusters.
// - West: the Checkpoint, barrier chicanes on the west road, kept open.
// - North-west: the Quarry Camp, sandbag trenches and two bunkers.
//
// Plan (metres from the centre): compound |x|, |z| < 9, Ring Road to about
// 27, districts from there to the walls at 45. North is -z.
import { box, type Obstacle } from "../types.ts";
import type { RoyaleMapDef } from "./index.ts";

const H = 45;

/** Brick wall height: long thin walls stay low (1.1-1.4 m) so they never hide a player's chest. */
const WALL = 1.3;

/**
 * A 6 x 6 m brick house, 1 m walls, one 2 m door in the middle of side
 * `door` (n = -z, s = +z, w = -x, e = +x). Four boxes.
 */
function house(cx: number, cz: number, door: "n" | "s" | "e" | "w"): Obstacle[] {
  switch (door) {
    case "w":
      return [box("wall", cx, cz - 2.5, 6, 1, WALL), box("wall", cx, cz + 2.5, 6, 1, WALL), box("wall", cx + 2.5, cz, 1, 4, WALL), box("wall", cx - 2.5, cz - 1, 1, 2, WALL)];
    case "e":
      return [box("wall", cx, cz - 2.5, 6, 1, WALL), box("wall", cx, cz + 2.5, 6, 1, WALL), box("wall", cx - 2.5, cz, 1, 4, WALL), box("wall", cx + 2.5, cz + 1, 1, 2, WALL)];
    case "n":
      return [box("wall", cx - 2.5, cz, 1, 6, WALL), box("wall", cx + 2.5, cz, 1, 6, WALL), box("wall", cx, cz + 2.5, 4, 1, WALL), box("wall", cx + 1, cz - 2.5, 2, 1, WALL)];
    case "s":
      return [box("wall", cx - 2.5, cz, 1, 6, WALL), box("wall", cx + 2.5, cz, 1, 6, WALL), box("wall", cx, cz - 2.5, 4, 1, WALL), box("wall", cx - 1, cz + 2.5, 2, 1, WALL)];
  }
}

// The Headframe: the shaft tower in a walled compound. Four doors, none on a
// road axis (a pinwheel), and crate stacks against the inside walls, so the
// yard round the tower is a ring of 3.5 m lanes.
/**
 * A 9 x 9 m brick yard, 1 m walls, a 2 x 2 m crate stack in the middle and
 * two 2.5 m doors: in the west wall's south end and the east wall's north
 * end, or (flip) the other way round. Five boxes.
 */
function yard(cx: number, cz: number, flip: boolean): Obstacle[] {
  const s = flip ? -1 : 1;
  return [
    box("wall", cx, cz - 4, 9, 1, WALL),
    box("wall", cx, cz + 4, 9, 1, WALL),
    box("wall", cx - 4, cz - 1.25 * s, 1, 4.5, WALL),
    box("wall", cx + 4, cz + 1.25 * s, 1, 4.5, WALL),
    box("crate", cx, cz, 2, 2, 1.4),
  ];
}

const HEADFRAME: Obstacle[] = [
  box("container", 0, 0, 5, 5, 1.9),
  // North wall, door at x 3..5.5.
  box("wall", -3, -8.5, 12, 1, WALL),
  box("wall", 7.25, -8.5, 3.5, 1, WALL),
  // East wall, door at z 3..5.5.
  box("wall", 8.5, -2.5, 1, 11, WALL),
  box("wall", 8.5, 7.25, 1, 3.5, WALL),
  // South wall, door at x -5.5..-3.
  box("wall", -7.25, 8.5, 3.5, 1, WALL),
  box("wall", 2.5, 8.5, 11, 1, WALL),
  // West wall, door at z -5.5..-3.
  box("wall", -8.5, -6.75, 1, 2.5, WALL),
  box("wall", -8.5, 2.5, 1, 11, WALL),
  // Crate stacks and barrels against the inside walls.
  box("crate", -4.5, -7, 3, 2, 1.4),
  box("crate", 7, -4.5, 2, 3, 1.4),
  box("crate", 4.5, 7, 3, 2, 1.4),
  box("crate", -7, 4.5, 2, 3, 1.4),
  box("barrels", 7, -7, 2, 2, 1.1),
  box("barrels", -7, 7, 2, 2, 1.1),
];

// The four roads out of the middle: clear 9 m lanes (|x| or |z| < 4.5),
// with cover only along their edges.
const ROADS: Obstacle[] = [
  // North road.
  box("barrier", -5, -13, 1, 4, 1.2),
  box("crate", -5.5, -21, 2, 4, 1.4),
  box("crate", 5.5, -16, 2, 4, 1.4),
  box("barrier", 5, -24, 1, 4, 1.2),
  box("barrier", -5, -26.5, 1, 3, 1.2),
  // East road.
  box("barrier", 13, -5, 4, 1, 1.2),
  box("crate", 21, -5.5, 4, 2, 1.4),
  box("crate", 16, 5.5, 4, 2, 1.4),
  box("barrier", 24, 5, 4, 1, 1.2),
  // South road.
  box("barrier", 5, 13, 1, 4, 1.2),
  box("crate", 5.5, 21, 2, 4, 1.4),
  box("crate", -5.5, 16, 2, 4, 1.4),
  box("barrier", -5, 23.5, 1, 4, 1.2),
  // West road.
  box("barrier", -13, 5, 4, 1, 1.2),
  box("crate", -21, 5.5, 4, 2, 1.4),
  box("crate", -16, -5.5, 4, 2, 1.4),
  box("barrier", -24, -5, 4, 1, 1.2),
  box("barrier", -27.5, 5, 3, 1, 1.2),
];

// The Ring Road: open ground round four small walled yards, one in each
// quarter, each with a crate stack inside and two 2.5 m doors in opposite
// corners (turned differently in each yard).
const RING: Obstacle[] = [
  ...yard(-16, -16, false), // North-west: the Stores yard.
  ...yard(16, -16, true), // North-east: the Truck yard.
  ...yard(16, 16, false), // South-east: the Ore yard.
  ...yard(-16, 16, true), // South-west: the Timber yard.
  box("sandbags", 12, 24.5, 4, 1, 1.1),
  box("barrels", -23.5, 22, 1.5, 1.5, 1.1),
];

const RAIL_SIDINGS: Obstacle[] = [
  // Wagons are long containers (Container_Long); the short ones at the ends are small containers.
  // Line A, against the north wall. The wagons nearest the middle line the north road.
  box("wagon", -23, -41, 6, 2, 1.8),
  box("wagon", -13, -41, 6, 2, 1.8),
  box("container", -6.5, -41, 3, 2, 1.8),
  box("wagon", 8, -41, 6, 2, 1.8),
  box("wagon", 18, -41, 6, 2, 1.8),
  box("container", 25.25, -41, 3.5, 2, 1.8),
  // Line B.
  box("wagon", -19, -35, 6, 2, 1.8),
  box("wagon", -8, -35, 6, 2, 1.8),
  box("wagon", 8, -35, 6, 2, 1.8),
  box("wagon", 19.5, -35, 6, 2, 1.8),
  // Line C, facing the ring.
  box("wagon", -20, -29, 6, 2, 1.8),
  box("wagon", -8, -29, 6, 2, 1.8),
  box("wagon", 8, -29, 6, 2, 1.8),
  box("wagon", 18, -29, 6, 2, 1.8),
  // Crates between line A and the north wall close its lane into pockets.
  box("crate", -23, -43.5, 2, 3, 1.3),
  box("crate", -13, -43.5, 2, 3, 1.4),
  box("crate", 8, -43.5, 2, 3, 1.4),
  box("crate", 18, -43.5, 2, 3, 1.3),
  // Loose cargo between the lines: some blocks a strip, some leaves a 2.5 m lane.
  box("crate", -21, -38, 2, 4, 1.4),
  box("crate", -11.25, -38, 2.5, 4, 1.4),
  box("crate", -6, -38, 2, 4, 1.4),
  box("crate", 6, -38, 2, 4, 1.4),
  box("crate", 18.75, -38, 2.5, 4, 1.4),
  box("crate", -6, -32, 2, 4, 1.4),
  box("crate", 6, -32, 2, 4, 1.3),
  box("crate", -20.5, -32, 2, 4, 1.3),
  box("barrels", 19.5, -32, 2, 4, 1.1),
];

const ENGINE_SHED: Obstacle[] = [
  // North wall, door at x 38..40.
  box("wall", 33.5, -40.5, 9, 1, WALL),
  box("wall", 41.5, -40.5, 3, 1, WALL),
  // South wall, door at x 33..35.
  box("wall", 31, -31.5, 4, 1, WALL),
  box("wall", 39, -31.5, 8, 1, WALL),
  // West wall, door at z -37..-35.
  box("wall", 29.5, -38.5, 1, 3, WALL),
  box("wall", 29.5, -33.5, 1, 3, WALL),
  // East wall.
  box("wall", 42.5, -36, 1, 8, WALL),
  // The locomotive, and spares stacked in the corners.
  box("container", 36.5, -36, 6, 2, 1.8),
  box("crate", 31, -33, 2, 2, 1.4),
  box("crate", 41.25, -39.25, 1.5, 1.5, 1.4),
  box("gastank", 34.5, -39.5, 2, 1, 1.2),
  // Outside: a coal pile by the south door, a water tank in the north yard.
  box("crate", 33, -28, 3, 2, 1.3),
  box("tank", 33.5, -44.1, 4.5, 1.8, 1.35),
];

const MAIN_STREET: Obstacle[] = [
  // West side, doors onto the street.
  ...house(30, -19, "e"),
  ...house(30, -8, "e"),
  ...house(30, 10, "e"),
  ...house(30, 19, "e"),
  // East side, backs to the wall.
  ...house(42, -20, "w"),
  ...house(42, -7, "w"),
  ...house(42, 7, "w"),
  ...house(42, 20, "w"),
  // Barrels in two of the houses.
  box("barrels", 41, -8.25, 2, 1.5, 1.1),
  box("barrels", 41, 18.75, 2, 1.5, 1.1),
  // Dumpsters and barrels in the yards between the east houses.
  box("dumpster", 43.75, -13.5, 2.5, 1.4, 1.35),
  box("barrels", 44, 0, 2, 2, 1.1),
  box("dumpster", 43.75, 13.5, 2.5, 1.4, 1.35),
  // Carts and trucks parked against the houses, alternating sides, so the
  // street is a zigzag and no lane runs its whole length.
  box("crate", 36, -2, 2, 4, 1.4),
  box("crate", 38, -21.5, 2, 3, 1.4),
  box("crate", 34, -17.5, 2, 3, 1.3),
  box("dumpster", 38.3, -8.75, 1.4, 2.5, 1.35),
  box("crate", 38, 5.5, 2, 3, 1.3),
  box("crate", 34, 11.5, 2, 3, 1.4),
  box("crate", 38, 18.25, 2, 2.5, 1.4),
  box("barrels", 34, 21, 2, 2, 1.1),
];

// The Slag Heaps: a maze of slag rocks, crate stacks and barrels, 2-2.5 m lanes, the
// rows staggered so no lane runs straight through.
const SLAG_HEAPS: Obstacle[] = [
  box("rock", 29.5, 29.25, 3, 2.5, 1.4),
  box("barrels", 34.75, 29.25, 2.5, 2.5, 1.1),
  box("rock", 40, 29.25, 3, 2.5, 1.3),
  box("crate", 44.25, 29.25, 1.5, 2.5, 1.4),
  box("rock", 31, 34.25, 3, 2.5, 1.3),
  box("barrels", 36.25, 34.25, 2.5, 2.5, 1.1),
  box("crate", 41.25, 34.25, 2.5, 2.5, 1.4),
  box("barrels", 29.25, 39.25, 2.5, 2.5, 1.1),
  box("rock", 34.5, 39.25, 3, 2.5, 1.4),
  box("crate", 39.75, 39.25, 2.5, 2.5, 1.3),
  box("barrels", 44.25, 39.25, 1.5, 2.5, 1.1),
  box("rock", 30.75, 43.75, 2.5, 2.5, 1.3),
  box("rock", 36.5, 43.75, 3, 2.5, 1.4),
  box("barrels", 41.75, 43.75, 2.5, 2.5, 1.1),
];

const WORKERS_ROW: Obstacle[] = [
  // Huts: the two that open north keep a crate, the two that open south a start.
  // Back row, against the south wall.
  ...house(-21, 39, "n"),
  ...house(-11, 39, "s"),
  ...house(11, 39, "n"),
  ...house(21, 39, "s"),
  // Front row, facing the ring; the two inner huts line the south road.
  ...house(-16, 30.5, "n"),
  ...house(-7.5, 30.5, "s"),
  ...house(7.5, 30.5, "s"),
  ...house(16, 30.5, "n"),
  box("barrels", -19.75, 40.25, 1.5, 1.5, 1.1),
  box("barrels", 12.25, 40.25, 1.5, 1.5, 1.1),
  // Junk in the alleys between the huts.
  box("dumpster", -17.3, 39, 1.4, 2.5, 1.35),
  box("dumpster", 14.7, 40, 1.4, 2.5, 1.35),
  // Carts across the lane between the two rows, so it doesn't run straight through.
  box("crate", -18.5, 34.75, 1, 2.5, 1.3),
  box("barrels", -9.25, 34.75, 2.5, 2.5, 1.1),
  box("crate", 13.5, 34.75, 1, 2.5, 1.3),
  box("barrels", 18.5, 34.75, 1, 2.5, 1.1),
];

// The Fuel Yard: a fuel tank, a water tank lying by the wall, and tight
// clusters of barrels and gas tanks, 2-2.5 m lanes.
const FUEL_YARD: Obstacle[] = [
  box("container", -37, 37, 4, 4, 1.9),
  box("tank", -29.75, 43, 2, 4, 1.35),
  box("barrels", -43.75, 29.5, 2.5, 2, 1.1),
  box("barrels", -38.75, 29.5, 2.5, 2, 1.1),
  box("barrels", -33.75, 29.5, 2.5, 2, 1.1),
  box("barrels", -28.75, 29.5, 2.5, 2, 1.1),
  box("gastank", -42, 33.5, 2, 2, 1.2),
  box("barrels", -31.75, 33.75, 2.5, 2.5, 1.1),
  box("gastank", -32, 38, 2, 2, 1.2),
  box("barrels", -43.75, 40.5, 2.5, 2, 1.1),
  box("barrels", -35.75, 42, 2.5, 2, 1.1),
];

// The Checkpoint stays open: a chicane on the road, two guard huts, two sandbag posts.
const CHECKPOINT: Obstacle[] = [
  box("barrier", -30, -1.5, 1, 4, 1.2),
  box("barrier", -35.5, 1.5, 1, 4, 1.2),
  box("barrier", -41, -1.5, 1, 4, 1.2),
  ...house(-36, -12, "s"),
  ...house(-36, 13, "n"),
  box("trench", -30, -20, 4, 1, 1.25),
  box("trench", -30, 21, 1, 4, 1.25),
  box("crate", -42, 8, 2, 2, 1.4),
];

// The Quarry Camp: an L of trenches round two bunkers, and quarried rock.
const QUARRY_CAMP: Obstacle[] = [
  box("container", -38, -38.5, 4, 3, 1.8),
  box("container", -31, -31, 3, 3, 1.8),
  box("trench", -40.25, -34, 9.5, 1, 1.25),
  box("trench", -35, -31.25, 1, 6.5, 1.25),
  box("trench", -41.5, -42.5, 7, 1, 1.25),
  box("trench", -33, -39.75, 1, 6.5, 1.25),
  box("trench", -40.25, -29.5, 5.5, 1, 1.25),
  box("rock", -29, -38, 2, 3, 1.4),
  box("rock", -29, -44, 2, 2, 1.3),
];

const OBSTACLES: Obstacle[] = [
  ...HEADFRAME,
  ...ROADS,
  ...RING,
  ...RAIL_SIDINGS,
  ...ENGINE_SHED,
  ...MAIN_STREET,
  ...SLAG_HEAPS,
  ...WORKERS_ROW,
  ...FUEL_YARD,
  ...CHECKPOINT,
  ...QUARRY_CAMP,
];

const STARTS = [
  { x: -42, z: -36 }, // Quarry Camp
  { x: -14, z: -32 }, // Rail Sidings west
  { x: 16, z: -32 }, // Rail Sidings east
  { x: 44, z: -36 }, // Engine Shed, behind its east wall
  { x: 30, z: -19 }, // Main Street north, in a house
  { x: 42, z: 7 }, // Main Street south, in a house
  { x: 37, z: 37 }, // Slag Heaps
  { x: 21, z: 39 }, // Workers' Row east, in a hut
  { x: -11, z: 39 }, // Workers' Row west, in a hut
  { x: -40.5, z: 43 }, // Fuel Yard
  { x: -36, z: 13 }, // Checkpoint south, in a guard hut
  { x: -36, z: -12 }, // Checkpoint north, in a guard hut
  { x: 13.3, z: -18.2 }, // Ring north-east, in the Truck yard
  { x: -15.5, z: 18 }, // Ring south-west, in the Timber yard
];

const CRATES = [
  // Headframe, in the compound's lanes.
  { x: 4.5, z: -5 },
  { x: -5, z: -4.5 },
  { x: -4.5, z: 5 },
  { x: 5, z: 4.5 },
  // Safe: in buildings and the cluttered districts.
  { x: 32, z: -38.5 },
  { x: 40.5, z: -33.5 },
  { x: 30, z: 19 },
  { x: 42, z: -20 },
  { x: -21.8, z: 38.5 },
  { x: 10.2, z: 38.5 },
  { x: -43, z: 36.5 },
  { x: -35, z: -41 },
  { x: 42.5, z: 37.5 },
  { x: -16, z: -37.5 },
  // Open: on the roads and the ring.
  { x: 0, z: -31 },
  { x: 0, z: 31 },
  { x: 29, z: 0 },
  { x: -27, z: 0 },
  { x: -24, z: -32 },
  { x: 12.5, z: -23 },
  { x: -20, z: 0 },
  { x: 22.5, z: 22.5 },
  { x: -13, z: 23.5 },
];

export const IRONVALE: RoyaleMapDef = {
  id: "ironvale",
  name: "Ironvale",
  blurb: "An abandoned mining town in the snow: a shaft tower in the middle, a ring road round it, and eight districts each built its own way.",
  mode: "royale",
  players: { min: 2, max: 10 },
  halfX: H,
  halfZ: H,
  obstacles: OBSTACLES,
  spawns: STARTS,
  royale: { crates: CRATES, zone: { x0: -24, z0: -24, x1: 24, z1: 24 } },
  hub: { x: 0, z: 0 },
  zones: [
    { id: "headframe", name: "Headframe", x0: -9, z0: -9, x1: 9, z1: 9, tint: 0x4f7fb3 },
    { id: "ring", name: "Ring Road", x0: -27, z0: -27, x1: 27, z1: 27, tint: 0xa7a9a3 },
    { id: "rail", name: "Rail Sidings", x0: -27, z0: -45, x1: 27, z1: -27, tint: 0x4f7fb3 },
    { id: "shed", name: "Engine Shed", x0: 27, z0: -45, x1: 45, z1: -27, tint: 0xa2503c },
    { id: "main", name: "Main Street", x0: 27, z0: -27, x1: 45, z1: 27, tint: 0xa2503c },
    { id: "slag", name: "Slag Heaps", x0: 27, z0: 27, x1: 45, z1: 45, tint: 0xb9823f },
    { id: "row", name: "Workers' Row", x0: -27, z0: 27, x1: 27, z1: 45, tint: 0xcdb57a },
    { id: "fuel", name: "Fuel Yard", x0: -45, z0: 27, x1: -27, z1: 45, tint: 0xc8453a },
    { id: "checkpoint", name: "Checkpoint", x0: -45, z0: -27, x1: -27, z1: 27, tint: 0xa7a9a3 },
    { id: "quarry", name: "Quarry Camp", x0: -45, z0: -45, x1: -27, z1: -27, tint: 0xcdb57a },
  ],
  landmarks: [
    { name: "Headframe", x: 0, z: 0 },
    { name: "Rail Sidings", x: 0, z: -36 },
    { name: "Engine Shed", x: 36, z: -36 },
    { name: "Main Street", x: 36, z: 0 },
    { name: "Slag Heaps", x: 36, z: 36 },
    { name: "Workers' Row", x: 0, z: 38 },
    { name: "Fuel Yard", x: -37, z: 37 },
    { name: "Checkpoint", x: -36, z: 0 },
    { name: "Quarry Camp", x: -37, z: -37 },
  ],
  // Snowy pines and dead trees outside the walls. The camera looks from the
  // +x / +z side, so a tree just outside those walls would hide the floor
  // near them: the woods are on the north (-z) and west (-x) sides, the top
  // of the screen, and only a few stand far out (15 m) on the south and east.
  // royale-maps.test.ts checks that no tree hides any floor.
  decor: [
    { prop: "PineTree_Snow_1", x: -58, z: -50, yaw: 0.0, scale: 2.2 },
    { prop: "PineTree_Snow_4", x: -50, z: -55, yaw: 4.7, scale: 2 },
    { prop: "CommonTree_Dead_Snow_2", x: -41, z: -50, yaw: 3.1, scale: 2 },
    { prop: "CommonTree_Dead_Snow_5", x: -33, z: -55, yaw: 1.5, scale: 2.2 },
    { prop: "PineTree_Snow_3", x: -24, z: -50, yaw: 6.2, scale: 2 },
    { prop: "CommonTree_Dead_Snow_1", x: -15, z: -55, yaw: 4.6, scale: 2 },
    { prop: "CommonTree_Dead_Snow_4", x: -6, z: -50, yaw: 3.0, scale: 2.2 },
    { prop: "PineTree_Snow_2", x: 3, z: -55, yaw: 1.4, scale: 2 },
    { prop: "PineTree_Snow_5", x: 12, z: -50, yaw: 6.1, scale: 2 },
    { prop: "CommonTree_Dead_Snow_3", x: 21, z: -55, yaw: 4.5, scale: 2.2 },
    { prop: "PineTree_Snow_1", x: 30, z: -50, yaw: 2.9, scale: 2 },
    { prop: "PineTree_Snow_4", x: 39, z: -55, yaw: 1.3, scale: 2 },
    { prop: "CommonTree_Dead_Snow_2", x: 48, z: -50, yaw: 6.0, scale: 2.2 },
    { prop: "CommonTree_Dead_Snow_5", x: 57, z: -55, yaw: 4.4, scale: 2 },
    { prop: "PineTree_Snow_3", x: -55, z: -40, yaw: 2.8, scale: 2.2 },
    { prop: "CommonTree_Dead_Snow_1", x: -50, z: -30, yaw: 1.2, scale: 2 },
    { prop: "CommonTree_Dead_Snow_4", x: -55, z: -20, yaw: 5.9, scale: 2 },
    { prop: "PineTree_Snow_2", x: -50, z: -10, yaw: 4.3, scale: 2.2 },
    { prop: "PineTree_Snow_5", x: -55, z: 0, yaw: 2.7, scale: 2 },
    { prop: "CommonTree_Dead_Snow_3", x: -50, z: 10, yaw: 1.1, scale: 2 },
    { prop: "PineTree_Snow_1", x: -55, z: 20, yaw: 5.8, scale: 2.2 },
    { prop: "PineTree_Snow_4", x: -50, z: 30, yaw: 4.2, scale: 2 },
    { prop: "CommonTree_Dead_Snow_2", x: -55, z: 40, yaw: 2.6, scale: 2 },
    { prop: "CommonTree_Dead_Snow_5", x: -50, z: 50, yaw: 1.0, scale: 2.2 },
    { prop: "PineTree_Snow_3", x: -40, z: 60, yaw: 5.7, scale: 2 },
    { prop: "CommonTree_Dead_Snow_1", x: -20, z: 60, yaw: 4.1, scale: 2 },
    { prop: "CommonTree_Dead_Snow_4", x: 0, z: 60, yaw: 2.5, scale: 2 },
    { prop: "PineTree_Snow_2", x: 20, z: 60, yaw: 0.9, scale: 2 },
    { prop: "PineTree_Snow_5", x: 40, z: 60, yaw: 5.6, scale: 2 },
    { prop: "CommonTree_Dead_Snow_3", x: 60, z: -40, yaw: 4.0, scale: 2 },
    { prop: "PineTree_Snow_1", x: 60, z: -20, yaw: 2.4, scale: 2 },
    { prop: "PineTree_Snow_4", x: 60, z: 0, yaw: 0.8, scale: 2 },
    { prop: "CommonTree_Dead_Snow_2", x: 60, z: 20, yaw: 5.5, scale: 2 },
    { prop: "CommonTree_Dead_Snow_5", x: 60, z: 40, yaw: 3.9, scale: 2 },
  ],
  theme: {
    floor: 0xc6cfd8,
    grid: 0xaeb9c4,
    gridOpacity: 0.18,
    outerFloor: 0xe2e8ee,
    background: 0x9aa8b6,
    wall: "brick",
    hemiSky: 0xdde6f2,
    hemiGround: 0x5e6878,
    hemiIntensity: 1.15,
    sun: 0xd8e4f4,
    sunIntensity: 1.7,
    sunDir: { x: 20, y: 14, z: -8 },
  },
  favours: ["rifle", "sniper", "smg"],
};
