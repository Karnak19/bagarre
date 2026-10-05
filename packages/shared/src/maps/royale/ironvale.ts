// Ironvale: an abandoned mining town in the snow, under an overcast winter
// sky, 150 m a side. In the middle, the Headframe: the mine shaft tower (one
// tall container block) in a walled compound, with four crates to fight over
// early. Four roads run out to the edge as clear lanes (|x| or |z| < 4.5)
// with cover only along their edges. Round the compound the Ring Road stays
// open, except for four small walled yards (one per quarter) that give any
// final circle some cover.
//
// Three belts round the ring, with open snow between them, so getting from
// one to the next is a choice and a risk:
//
// The old town, against the walls: eight districts, each built from its own
// kind of prop; five are dense, with 2-3 m lanes (shotgun and SMG ground).
// Each keeps its own layout from the 90 m map, moved out as one piece.
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
// The pit works, halfway out: four districts on the diagonals and lighter
// outskirts by the roads.
//
// - North-west: the Sawmill, rows of lumber stacks with 2.5 m lanes.
// - North-east: the Freight Depot, tall shipping containers in staggered rows.
// - South-east: the Pithead Baths, one big brick building with two rooms.
// - South-west: the Tank Farm, lines of lying tanks and gas tank clusters.
// - North road: the Dugouts, U-shaped sandbag posts.
// - East road: the Truck Stop, parked trucks (dumpsters) in two lots.
// - South road: the Spoil Tips, loose boulders.
// - West road: the Powder Store, two brick magazines with gas tanks.
//
// The Outskirts: the open snow between the old districts along the walls,
// with a lone miner's hut (its door to the wall, a start inside) and a few
// boulders in each gap.
//
// Plan (metres from the centre, north is -z): compound |x|, |z| < 9; Ring
// Road to about 31; open snow to 35; the pit works from 35 to about 53; open
// snow to 57; the old town from 57 to the walls at 75.
import { box, type Decor, type Obstacle } from "../types.ts";
import type { RoyaleMapDef } from "./index.ts";

const H = 75;

/** A district's boxes moved as one piece, by (dx, dz): its own layout stays as it was built. */
function moved(dx: number, dz: number, boxes: Obstacle[]): Obstacle[] {
  return boxes.map((o) => ({ ...o, x: o.x + dx, z: o.z + dz }));
}

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
  // Where the roads leave the ring.
  box("crate", 5.5, -30, 2, 3, 1.4),
  box("crate", 30, -5.5, 3, 2, 1.4),
  box("crate", -5.5, 30, 2, 3, 1.4),
];

// The Ring Road: open ground round four small walled yards, one in each
// quarter, each with a crate stack inside and two 2.5 m doors in opposite
// corners (turned differently in each yard).
const RING: Obstacle[] = [
  ...yard(-19, -19, false), // North-west: the Stores yard.
  ...yard(19, -19, true), // North-east: the Truck yard.
  ...yard(19, 19, false), // South-east: the Ore yard.
  ...yard(-19, 19, true), // South-west: the Timber yard.
  box("sandbags", 14, 28, 4, 1, 1.1),
  box("barrels", -27, 25, 1.5, 1.5, 1.1),
  box("sandbags", -28, -13, 1, 4, 1.1),
  box("barrels", 26, -27, 1.5, 1.5, 1.1),
];

// The roads on through the pit works: cover on their edges only, the lane clear.
const MID_ROADS: Obstacle[] = [
  box("barrier", -5.5, -38, 1, 4, 1.2),
  box("crate", 5.5, -44, 2, 4, 1.4),
  box("barrier", -5.5, -50, 1, 4, 1.2),
  box("barrier", 38, 5.5, 4, 1, 1.2),
  box("crate", 44, -5.5, 4, 2, 1.4),
  box("barrier", 50, 5.5, 4, 1, 1.2),
  box("barrier", 5.5, 38, 1, 4, 1.2),
  box("crate", -5.5, 44, 2, 4, 1.4),
  box("barrier", 5.5, 50, 1, 4, 1.2),
  box("barrier", -38, -5.5, 4, 1, 1.2),
  box("crate", -44, 5.5, 4, 2, 1.4),
  box("barrier", -50, -5.5, 4, 1, 1.2),
];

const RAIL_SIDINGS: Obstacle[] = moved(0, -30, [
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
]);

const ENGINE_SHED: Obstacle[] = moved(30, -30, [
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
]);

const MAIN_STREET: Obstacle[] = moved(30, 0, [
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
]);

// The Slag Heaps: a maze of slag rocks, crate stacks and barrels, 2-2.5 m lanes, the
// rows staggered so no lane runs straight through.
const SLAG_HEAPS: Obstacle[] = moved(30, 30, [
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
]);

const WORKERS_ROW: Obstacle[] = moved(0, 30, [
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
]);

// The Fuel Yard: a fuel tank, a water tank lying by the wall, and tight
// clusters of barrels and gas tanks, 2-2.5 m lanes.
const FUEL_YARD: Obstacle[] = moved(-30, 30, [
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
]);

// The Checkpoint stays open: a chicane on the road, two guard huts, two sandbag posts.
const CHECKPOINT: Obstacle[] = moved(-30, 0, [
  box("barrier", -30, -1.5, 1, 4, 1.2),
  box("barrier", -35.5, 1.5, 1, 4, 1.2),
  box("barrier", -41, -1.5, 1, 4, 1.2),
  ...house(-36, -12, "s"),
  ...house(-36, 13, "n"),
  box("trench", -30, -20, 4, 1, 1.25),
  box("trench", -30, 21, 1, 4, 1.25),
  box("crate", -42, 8, 2, 2, 1.4),
]);

// The Quarry Camp: an L of trenches round two bunkers, and quarried rock.
const QUARRY_CAMP: Obstacle[] = moved(-30, -30, [
  box("container", -38, -38.5, 4, 3, 1.8),
  box("container", -31, -31, 3, 3, 1.8),
  box("trench", -40.25, -34, 9.5, 1, 1.25),
  box("trench", -35, -31.25, 1, 6.5, 1.25),
  box("trench", -41.5, -42.5, 7, 1, 1.25),
  box("trench", -33, -39.75, 1, 6.5, 1.25),
  box("trench", -40.25, -29.5, 5.5, 1, 1.25),
  box("rock", -29, -38, 2, 3, 1.4),
  box("rock", -29, -44, 2, 2, 1.3),
]);

// --- The pit works --------------------------------------------------------------------

// The Sawmill: three rows of lumber stacks along x, 2.5 m lanes between
// them, each row broken once (the breaks staggered), and the saw house.
const SAWMILL: Obstacle[] = [
  box("crate", -48, -49.5, 6, 2, 1.4),
  box("crate", -39.5, -49.5, 6, 2, 1.4),
  box("crate", -45.5, -45, 6, 2, 1.4),
  box("crate", -38, -45, 4, 2, 1.3),
  box("crate", -48, -40.5, 6, 2, 1.4),
  box("crate", -39.5, -40.5, 6, 2, 1.4),
  // The saw house.
  box("container", -47, -36.75, 4, 2, 1.8),
];

// The Freight Depot: tall shipping containers in three staggered rows, so
// the lanes between them never run straight through.
const FREIGHT_DEPOT: Obstacle[] = [
  box("container", 38.5, -49, 5, 3, 1.9),
  box("container", 46.5, -49, 5, 3, 1.9),
  box("container", 41, -43.5, 5, 3, 1.9),
  box("container", 49, -43.5, 4, 3, 1.9),
  box("container", 37.5, -38, 3, 3, 1.9),
  box("container", 44.5, -38, 5, 3, 1.9),
];

// The Pithead Baths: one 14 x 12 m brick building, 1 m walls, a door in
// each side and a partition with a doorway, so two rooms: lockers in the
// west one, the boiler in the east one.
const PITHEAD_BATHS: Obstacle[] = [
  // North wall, door at x 40..42.
  box("wall", 38.5, 37.5, 3, 1, WALL),
  box("wall", 46.5, 37.5, 9, 1, WALL),
  // South wall, door at x 46..48.
  box("wall", 41.5, 48.5, 9, 1, WALL),
  box("wall", 49.5, 48.5, 3, 1, WALL),
  // West wall, door at z 41..43.
  box("wall", 37.5, 39.5, 1, 3, WALL),
  box("wall", 37.5, 45.5, 1, 5, WALL),
  // East wall, door at z 44..46.
  box("wall", 50.5, 41, 1, 6, WALL),
  box("wall", 50.5, 47, 1, 2, WALL),
  // The partition, doorway at z 42..44.
  box("wall", 44, 40, 1, 4, WALL),
  box("wall", 44, 46, 1, 4, WALL),
  // Lockers and the boiler.
  box("crate", 39, 47.25, 2, 1.5, 1.4),
  box("tank", 47.25, 41.5, 2, 3.5, 1.35),
];

// The Tank Farm: three lines of tanks lying along z, 2.5 m lanes between
// them, each line broken once (staggered), and gas tank clusters on the east side.
const TANK_FARM: Obstacle[] = [
  box("tank", -49, 39.5, 2, 5, 1.35),
  box("tank", -49, 47, 2, 5, 1.35),
  box("tank", -44.5, 42, 2, 5, 1.35),
  box("tank", -44.5, 49, 2, 4, 1.35),
  box("tank", -40, 39.5, 2, 5, 1.35),
  box("tank", -40, 47, 2, 5, 1.35),
  box("gastank", -35.5, 40, 2, 2, 1.2),
  box("gastank", -35.5, 46.5, 2, 2, 1.2),
];

/** A U of sandbags 5 m wide and 3 m deep, open to the south (+z). Three boxes. */
function dugout(cx: number, cz: number): Obstacle[] {
  return [box("sandbags", cx, cz - 1.5, 5, 1, 1.1), box("sandbags", cx - 2, cz + 0.5, 1, 3, 1.1), box("sandbags", cx + 2, cz + 0.5, 1, 3, 1.1)];
}

// The Dugouts, either side of the north road.
const DUGOUTS: Obstacle[] = [...dugout(-22, -42), ...dugout(-13, -48), ...dugout(13, -46), ...dugout(22, -40)];

// The Truck Stop: parked trucks in two lots either side of the east road.
const TRUCK_STOP: Obstacle[] = [
  box("dumpster", 39, -12, 1.4, 2.5, 1.35),
  box("dumpster", 39, -19, 1.4, 2.5, 1.35),
  box("dumpster", 45, -15.5, 1.4, 2.5, 1.35),
  box("dumpster", 45, -22, 1.4, 2.5, 1.35),
  box("barrier", 42, -27, 4, 1, 1.2),
  box("dumpster", 39, 12, 1.4, 2.5, 1.35),
  box("dumpster", 39, 19, 1.4, 2.5, 1.35),
  box("dumpster", 45, 15.5, 1.4, 2.5, 1.35),
  box("dumpster", 45, 22, 1.4, 2.5, 1.35),
  box("barrier", 42, 27, 4, 1, 1.2),
];

// The Spoil Tips: loose boulders either side of the south road.
const SPOIL_TIPS: Obstacle[] = [
  box("rock", -22, 40, 3, 2.5, 1.3),
  box("rock", -17, 46, 2.5, 3, 1.4),
  box("rock", -11, 39, 3, 2.5, 1.4),
  box("rock", 11, 42, 3, 2.5, 1.3),
  box("rock", 17, 48, 3, 2.5, 1.4),
  box("rock", 23, 40, 2.5, 3, 1.3),
];

// The Powder Store: two brick magazines either side of the west road, gas tanks round them.
const POWDER_STORE: Obstacle[] = [
  ...house(-44, -16, "e"),
  box("gastank", -44, -24, 2, 2, 1.2),
  box("gastank", -38, -20, 2, 2, 1.2),
  ...house(-44, 16, "e"),
  box("gastank", -44, 24, 2, 2, 1.2),
  box("gastank", -38, 20, 2, 2, 1.2),
];

// --- The Outskirts --------------------------------------------------------------------

/**
 * A lone miner's hut in the open snow between two old districts, its door
 * to the outer wall (so the start inside sees nothing of the map), and two
 * boulders 8-9 m either side along the wall. `door` is the wall it faces.
 */
function outskirt(cx: number, cz: number, door: "n" | "s" | "e" | "w"): Obstacle[] {
  const along = door === "n" || door === "s";
  // Toward the middle of the map.
  const inX = door === "e" ? -1 : door === "w" ? 1 : 0;
  const inZ = door === "s" ? -1 : door === "n" ? 1 : 0;
  return [
    ...house(cx, cz, door),
    along ? box("rock", cx + 8.5, cz + 3 * inZ, 3, 2.5, 1.3) : box("rock", cx + 3 * inX, cz + 8.5, 2.5, 3, 1.3),
    along ? box("rock", cx - 9, cz - 1.5 * inZ, 2.5, 3, 1.4) : box("rock", cx - 1.5 * inX, cz - 9, 3, 2.5, 1.4),
  ];
}

const OUTSKIRTS: Obstacle[] = [
  ...outskirt(-42, -66, "n"),
  ...outskirt(42, -66, "n"),
  ...outskirt(66, -42, "e"),
  ...outskirt(66, 42, "e"),
  ...outskirt(42, 66, "s"),
  ...outskirt(-42, 66, "s"),
  ...outskirt(-66, 42, "w"),
  ...outskirt(-66, -42, "w"),
];

const OBSTACLES: Obstacle[] = [
  ...HEADFRAME,
  ...ROADS,
  ...RING,
  ...MID_ROADS,
  ...RAIL_SIDINGS,
  ...ENGINE_SHED,
  ...MAIN_STREET,
  ...SLAG_HEAPS,
  ...WORKERS_ROW,
  ...FUEL_YARD,
  ...CHECKPOINT,
  ...QUARRY_CAMP,
  ...SAWMILL,
  ...FREIGHT_DEPOT,
  ...PITHEAD_BATHS,
  ...TANK_FARM,
  ...DUGOUTS,
  ...TRUCK_STOP,
  ...SPOIL_TIPS,
  ...POWDER_STORE,
  ...OUTSKIRTS,
];

// Starts: all in the old town, the pit works and the Outskirts (none on the
// Ring Road), most of them in a building or a pocket.
const STARTS = [
  { x: -72, z: -66 }, // Quarry Camp
  { x: -14, z: -62 }, // Rail Sidings west
  { x: 16, z: -62 }, // Rail Sidings east
  { x: 74, z: -66 }, // Engine Shed, behind its east wall
  { x: 60, z: -19 }, // Main Street north, in a house
  { x: 72, z: 7 }, // Main Street south, in a house
  { x: 67, z: 67 }, // Slag Heaps
  { x: 21, z: 69 }, // Workers' Row east, in a hut
  { x: -11, z: 69 }, // Workers' Row west, in a hut
  { x: -70.5, z: 73 }, // Fuel Yard
  { x: -66, z: 13 }, // Checkpoint south, in a guard hut
  { x: -66, z: -12 }, // Checkpoint north, in a guard hut
  { x: -44, z: -42.75 }, // Sawmill
  { x: 45.25, z: -43.5 }, // Freight Depot
  { x: 40.5, z: 44 }, // Pithead Baths, in the west room
  { x: -42.25, z: 45 }, // Tank Farm
  { x: -44, z: -16 }, // Powder Store north, in a magazine
  { x: -44, z: 16 }, // Powder Store south, in a magazine
  // The Outskirts' huts.
  { x: -42, z: -66 },
  { x: 42, z: -66 },
  { x: 66, z: -42 },
  { x: 66, z: 42 },
  { x: 42, z: 66 },
  { x: -42, z: 66 },
  { x: -66, z: 42 },
  { x: -66, z: -42 },
];

const CRATES = [
  // Headframe, in the compound's lanes.
  { x: 4.5, z: -5 },
  { x: -5, z: -4.5 },
  { x: -4.5, z: 5 },
  { x: 5, z: 4.5 },
  // Safe: in the old town's buildings and cluttered districts.
  { x: 62, z: -68.5 },
  { x: 70.5, z: -63.5 },
  { x: 60, z: 19 },
  { x: 72, z: -20 },
  { x: -21.8, z: 68.5 },
  { x: 10.2, z: 68.5 },
  { x: -73, z: 66.5 },
  { x: -65, z: -71 },
  { x: 72.5, z: 67.5 },
  { x: -16, z: -67.5 },
  // Safe: in the pit works.
  { x: -42, z: -47.25 },
  { x: -37, z: -42.75 },
  { x: 43, z: -46.25 },
  { x: 40, z: -40.75 },
  { x: 41, z: 40 },
  { x: 48.75, z: 45 },
  { x: -46.75, z: 38 },
  { x: -42.25, z: 39 },
  { x: -38.5, z: -17 },
  { x: -38.5, z: 15 },
  // Open: on the roads and the Ring Road.
  { x: 0, z: -31 },
  { x: 0, z: 31 },
  { x: 29, z: 0 },
  { x: -27, z: 0 },
  { x: 12.5, z: -23 },
  { x: -20, z: 0 },
  { x: 27, z: 27 },
  { x: -12, z: 26 },
  { x: -27, z: -27 },
  { x: 0, z: -46 },
  { x: 0, z: 46 },
  { x: 46, z: 0 },
  { x: -46, z: 0 },
  // Open: in the outskirts by the roads and the snow between the old districts.
  { x: -24, z: -62 },
  { x: -17.5, z: -45 },
  { x: 17.5, z: -42.5 },
  { x: 42, z: -18 },
  { x: 42, z: 18 },
  { x: -14, z: 43 },
  { x: 14, z: 45 },
  { x: 50.5, z: -59 },
  { x: -50, z: 62 },
  { x: 59, z: 50.5 },
  { x: -62, z: -50 },
];

const TREES = [
  "PineTree_Snow_1",
  "PineTree_Snow_4",
  "CommonTree_Dead_Snow_2",
  "CommonTree_Dead_Snow_5",
  "PineTree_Snow_3",
  "CommonTree_Dead_Snow_1",
  "CommonTree_Dead_Snow_4",
  "PineTree_Snow_2",
  "PineTree_Snow_5",
  "CommonTree_Dead_Snow_3",
] as const;

/** Trees outside the walls: a wood every 9-10 m along the north and west, a few far out (15 m) on the south and east. */
const WOODS: Decor[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ x: -88 + 9 * i, z: i % 2 ? -85 : -80 })),
  ...Array.from({ length: 16 }, (_, i) => ({ x: i % 2 ? -85 : -80, z: -70 + 10 * i })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: -70 + 20 * i, z: 90 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 90, z: -70 + 20 * i })),
].map((p, i) => ({ prop: TREES[i % TREES.length], x: p.x, z: p.z, yaw: (i * 1.6) % 6.28, scale: i % 3 ? 2 : 2.2 }));

export const IRONVALE: RoyaleMapDef = {
  id: "ironvale",
  name: "Ironvale",
  blurb: "An abandoned mining town in the snow: a shaft tower in the middle, a ring road round it, the pit works halfway out, and the old town's eight districts against the walls.",
  mode: "royale",
  players: { min: 2, max: 10 },
  halfX: H,
  halfZ: H,
  obstacles: OBSTACLES,
  spawns: STARTS,
  royale: { crates: CRATES, zone: { x0: -30, z0: -30, x1: 30, z1: 30 } },
  hub: { x: 0, z: 0 },
  // First match wins (the minimap draws them in reverse): the small
  // districts come before the open snow they sit in.
  zones: [
    { id: "headframe", name: "Headframe", x0: -9, z0: -9, x1: 9, z1: 9, tint: 0x4f7fb3 },
    { id: "ring", name: "Ring Road", x0: -31, z0: -31, x1: 31, z1: 31, tint: 0xa7a9a3 },
    // The pit works.
    { id: "sawmill", name: "Sawmill", x0: -53, z0: -53, x1: -35, z1: -35, tint: 0xb9823f },
    { id: "depot", name: "Freight Depot", x0: 35, z0: -53, x1: 53, z1: -35, tint: 0x4f7fb3 },
    { id: "baths", name: "Pithead Baths", x0: 35, z0: 35, x1: 53, z1: 53, tint: 0xa2503c },
    { id: "tanks", name: "Tank Farm", x0: -53, z0: 35, x1: -35, z1: 53, tint: 0xc8453a },
    { id: "dugouts", name: "Dugouts", x0: -27, z0: -53, x1: 27, z1: -35, tint: 0xcdb57a },
    { id: "trucks", name: "Truck Stop", x0: 35, z0: -29, x1: 53, z1: 29, tint: 0xa7a9a3 },
    { id: "spoil", name: "Spoil Tips", x0: -27, z0: 35, x1: 27, z1: 53, tint: 0xa7a9a3 },
    { id: "powder", name: "Powder Store", x0: -53, z0: -29, x1: -35, z1: 29, tint: 0xa2503c },
    // The old town.
    { id: "rail", name: "Rail Sidings", x0: -27, z0: -75, x1: 27, z1: -56, tint: 0x4f7fb3 },
    { id: "shed", name: "Engine Shed", x0: 57, z0: -75, x1: 75, z1: -56, tint: 0xa2503c },
    { id: "main", name: "Main Street", x0: 56, z0: -24, x1: 75, z1: 24, tint: 0xa2503c },
    { id: "slag", name: "Slag Heaps", x0: 57, z0: 57, x1: 75, z1: 75, tint: 0xb9823f },
    { id: "row", name: "Workers' Row", x0: -25, z0: 56, x1: 25, z1: 75, tint: 0xcdb57a },
    { id: "fuel", name: "Fuel Yard", x0: -75, z0: 57, x1: -57, z1: 75, tint: 0xc8453a },
    { id: "checkpoint", name: "Checkpoint", x0: -75, z0: -24, x1: -56, z1: 24, tint: 0xa7a9a3 },
    { id: "quarry", name: "Quarry Camp", x0: -75, z0: -75, x1: -57, z1: -57, tint: 0xcdb57a },
    // The Outskirts: the snow between the old districts along the walls.
    { id: "outskirts-n", name: "North Outskirts", x0: -57, z0: -75, x1: 57, z1: -56, tint: 0xe2e8ee },
    { id: "outskirts-s", name: "South Outskirts", x0: -57, z0: 56, x1: 57, z1: 75, tint: 0xe2e8ee },
    { id: "outskirts-e", name: "East Outskirts", x0: 56, z0: -57, x1: 75, z1: 57, tint: 0xe2e8ee },
    { id: "outskirts-w", name: "West Outskirts", x0: -75, z0: -57, x1: -56, z1: 57, tint: 0xe2e8ee },
  ],
  landmarks: [
    { name: "Headframe", x: 0, z: 0 },
    { name: "Sawmill", x: -44, z: -44 },
    { name: "Freight Depot", x: 44, z: -44 },
    { name: "Pithead Baths", x: 44, z: 43 },
    { name: "Tank Farm", x: -44, z: 44 },
    { name: "Dugouts", x: -17, z: -44 },
    { name: "Truck Stop", x: 42, z: -16 },
    { name: "Spoil Tips", x: 15, z: 44 },
    { name: "Powder Store", x: -44, z: 16 },
    { name: "Rail Sidings", x: 0, z: -66 },
    { name: "Engine Shed", x: 66, z: -66 },
    { name: "Main Street", x: 66, z: 0 },
    { name: "Slag Heaps", x: 66, z: 66 },
    { name: "Workers' Row", x: 0, z: 68 },
    { name: "Fuel Yard", x: -67, z: 67 },
    { name: "Checkpoint", x: -66, z: 0 },
    { name: "Quarry Camp", x: -67, z: -67 },
  ],
  // Snowy pines and dead trees outside the walls. The camera looks from the
  // +x / +z side, so a tree just outside those walls would hide the floor
  // near them: the woods are on the north (-z) and west (-x) sides, the top
  // of the screen, and only a few stand far out (15 m) on the south and east.
  // royale-maps.test.ts checks that no tree hides any floor.
  decor: WOODS,
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
