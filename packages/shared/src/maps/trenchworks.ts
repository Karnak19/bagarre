// Trenchworks: a sandbag trench network, 28 x 28 m. Short sightlines, lots
// of corners: shotgun and SMG country. Not mirrored, each side has its own
// structure:
// - the Warren (top of the screen, -x/-z, spawn 0): long parallel sandbag
//   trenches in tight 3 m cells, with two crate stacks at the junctions;
// - the Barrel Yard (bottom right, +x/+z, spawn 1): wider cells broken up by
//   barrel piles, short sandbag stubs off the east wall and a brick L;
// - the Brick Row (bottom left, spawn 2): one brick wall and a few stubs off
//   the south wall;
// - the Crater in the middle: a broken sandbag ring, open on its west and
//   south-east sides.
// Balance is measured by scripts/analyze.ts, not mirrored.
import { box, type MapDef } from "./types.ts";

const HALF = 14;

const SAND = 1.1;
const BRICK = 1.4;
const CRATE = 1.5;
const BARRELS = 1.1;

const OBSTACLES = [
  // The Warren (spawn 0's side): short sandbag trenches, 3 m cells.
  box("sandbags", -6.5, -5, 1, 10, SAND), // Long Trench
  box("barrels", -6.3, -13, 1.4, 2, BARRELS),
  box("sandbags", -3, -12, 2, 4, SAND),
  box("sandbags", -10, -10.5, 2, 1, SAND), // spawn 0's dugout
  box("sandbags", -10.5, -8.5, 1, 3, SAND),
  box("sandbags", -12, -1.5, 4, 1, SAND),
  box("sandbags", -1, -6.5, 6, 1, SAND),
  box("sandbags", 2.5, -8.5, 1, 5, SAND),
  box("crate", -1, -10, 2, 2, CRATE),
  box("crate", -3.4, -3.4, 2, 2, CRATE),
  box("sandbags", -7, 2.5, 6, 1, SAND),
  // The Brick Row (bottom left).
  box("sandbags", -11.5, 6.75, 1, 4.5, SAND),
  box("wall", -6, 7.5, 6, 1, BRICK),
  box("barrels", -9, 13, 2, 2, BARRELS),
  box("sandbags", -4.5, 12, 1, 4, SAND),
  // The Crater: a broken sandbag ring around the centre.
  box("sandbags", 2, -0.5, 6, 1, SAND),
  box("sandbags", 4.5, 1.5, 1, 3, SAND),
  box("sandbags", -1.5, 0.6, 1, 1.2, SAND),
  box("sandbags", -0.5, 4, 3, 2, SAND),
  // The Barrel Yard (spawn 1's side): barrel piles, stubs off the east wall, a brick L.
  box("sandbags", 11.6, -6.5, 4.8, 1, SAND),
  box("barrels", 9, -11, 2, 2, BARRELS),
  box("sandbags", 12.8, -9.5, 2.4, 1, SAND),
  box("barrels", 7.4, -3.4, 2, 2, BARRELS),
  box("sandbags", 10.5, 0, 1, 6, SAND),
  box("sandbags", 12.5, 2.5, 3, 1, SAND),
  box("sandbags", 7.5, 1.7, 1, 4.6, SAND),
  box("wall", 5.3, 6.5, 5.4, 1, BRICK),
  box("wall", 7.5, 8.5, 1, 3, BRICK),
  box("barrels", 11, 10, 2, 2, BARRELS),
  box("barrels", 13, 6, 2, 2, BARRELS),
  box("sandbags", 4.5, 12, 1, 4, SAND),
  box("sandbags", -0.5, 9.5, 1, 5, SAND), // splits the Yard from the Brick Row
];

export const TRENCHWORKS: MapDef = {
  id: "trenchworks",
  name: "Trenchworks",
  blurb: "Mud, sandbags and blind corners around a broken crater. Bring a shotgun.",
  halfX: HALF,
  halfZ: HALF,
  obstacles: OBSTACLES,
  spawns: [
    { x: -12.5, z: -12.5 },
    { x: 12.5, z: 12.5 },
    { x: -12.5, z: 12.5 },
    { x: 12.5, z: -12.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Pallet_Broken", x: 10.5, z: 5, yaw: 3.2 },
    { prop: "WoodPlanks", x: -1, z: -4.2, yaw: 4.7 },
    { prop: "Debris_Pile", x: -8.2, z: -6.5, yaw: 2.1 },
    { prop: "Pallet", x: 4.1, z: 8.1, yaw: 1.5 },
    { prop: "Pallet", x: 12, z: -4.5, yaw: 4.3 },
    { prop: "Pallet_Broken", x: -9.8, z: 8.3, yaw: 2.1 },
    { prop: "WoodPlanks", x: -4.8, z: 5, yaw: 0.7 },
    { prop: "Debris_Pile", x: 12.4, z: -10.9, yaw: 3.7 },
    { prop: "Pallet", x: 13, z: -1, yaw: 2.7 },
    { prop: "Pallet", x: -4.8, z: -8.8, yaw: 1.4 },
    { prop: "Pallet_Broken", x: 4, z: -9.6, yaw: 5.4 },
    { prop: "WoodPlanks", x: -12.8, z: -9.7, yaw: 3.1 },
    { prop: "Debris_Pile", x: 2, z: 1.5, yaw: 5.4 },
    { prop: "Pallet", x: -2.5, z: 11, yaw: 3.1 },
    // Outside the walls.
    { prop: "Debris_Tires", x: 9, z: -16.4, yaw: 5.9 },
    { prop: "ExplodingBarrel", x: 16, z: 8.7, yaw: 0.2 },
    { prop: "CardboardBoxes_1", x: 4.9, z: 15.7, yaw: 3.8 },
    { prop: "Debris_Tires", x: -16.4, z: -11.1, yaw: 0.1 },
    { prop: "Debris_Tires", x: 8.3, z: -16.3, yaw: 0.3 },
    { prop: "ExplodingBarrel", x: 15.7, z: -1.5, yaw: 3.2 },
    { prop: "CardboardBoxes_1", x: -10.7, z: 15.9, yaw: 1.3 },
    { prop: "Debris_Tires", x: -16.2, z: -1.8, yaw: 4.9 },
    { prop: "Debris_Tires", x: 10.1, z: -15.9, yaw: 5.2 },
    { prop: "ExplodingBarrel", x: 16, z: 1, yaw: 0.8 },
    { prop: "CardboardBoxes_1", x: 1.8, z: 16, yaw: 0.6 },
    { prop: "Debris_Tires", x: -15.6, z: -5.5, yaw: 1.1 },
  ],
  theme: {
    floor: 0x6b5a45,
    grid: 0x7d6a52,
    gridOpacity: 0.14,
    outerFloor: 0x3d3226,
    background: 0x1c1813,
    wall: "sandbags",
    hemiSky: 0xc9d3dd,
    hemiGround: 0x3b2f22,
    hemiIntensity: 1.35,
    sun: 0xe8e4da,
    sunIntensity: 1.6,
    sunDir: { x: -8, y: 22, z: 10 },
  },
  favours: ["shotgun", "smg"],
};
