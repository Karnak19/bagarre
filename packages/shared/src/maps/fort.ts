// Fort: a brick blockhouse in the middle, 32 x 32 m. Fight around it,
// through it, or lob grenades into it. Not mirrored:
// - the blockhouse is a 12 x 9 m hall with a guardroom annex on its
//   south-east corner (an L-shaped floor inside) around a crate keep. Four
//   doors, no two facing each other: north and south-west open on the Field
//   side, east on the Courtyard side, and the guardroom door on the South
//   Yard; a thick pier between hall and guardroom stops any sightline
//   through the building;
// - the Field (top of the screen, -x/-z, spawn 0): open ground with a sandbag
//   dugout, one trench line, a crate stack and a few barrels. Long looks, few
//   pieces;
// - the Courtyard (bottom right, +x/+z, spawn 1): brick stubs and a crate off
//   the east wall, barrels and crates in front of the spawn. Short looks,
//   more corners;
// - the South Yard (spawn 2) and the North Post (spawn 3) on the other two
//   corners.
// Balance is measured by scripts/analyze.ts, not mirrored.
import { box, type MapDef } from "./types.ts";

const HALF = 16;

const BRICK = 1.4;
const SAND = 1.1;
const CRATE = 1.5;
const BARRELS = 1.1;

const OBSTACLES = [
  // The blockhouse.
  box("wall", -5.5, -2.75, 1, 6.5, BRICK), // west wall
  box("wall", -2.5, -5.5, 5, 1, BRICK), // north wall
  box("wall", 4.25, -5.5, 3.5, 1, BRICK), // north-east corner
  box("wall", 5.5, -3, 1, 4, BRICK), // east wall, above the east door
  box("wall", 5.5, 4.75, 1, 6.5, BRICK), // guardroom east wall
  box("wall", -1, 2.5, 4, 1, BRICK), // hall south wall
  box("wall", 2, 3.5, 2, 3, BRICK), // pier between hall and guardroom
  box("wall", 3.5, 7.5, 3, 1, BRICK), // guardroom south wall
  box("crate", -1, -1.5, 2, 3, CRATE), // keep
  // The Field (spawn 0).
  box("sandbags", -13.75, -9.5, 4.5, 1, SAND), // dugout
  box("sandbags", -8.5, -14.8, 1, 2.4, SAND),
  box("sandbags", -9.5, -5.95, 1, 4.9, SAND), // trench
  box("barrels", -6.9, -9.3, 1, 2, BARRELS),
  box("crate", -2.5, -10.5, 2, 2, CRATE),
  box("barrels", -9, 1, 2, 2, BARRELS),
  box("sandbags", 1, -14, 1, 4, SAND),
  box("wall", -13.5, 5, 5, 1, BRICK),
  // The Courtyard (spawn 1).
  box("barrels", 10.7, 10.6, 2, 2, BARRELS),
  box("crate", 7, 12, 2, 2, CRATE),
  box("wall", 10, 3, 1, 4, BRICK),
  box("wall", 14, 7.5, 4, 1, BRICK),
  box("crate", 14.5, 3.5, 3, 2, CRATE),
  box("barrels", 14.5, -1, 3, 2, BARRELS),
  // The North Post (spawn 3).
  box("crate", 11, -11, 2, 2, CRATE),
  box("sandbags", 11.2, -6.5, 4.4, 1, SAND),
  box("barrels", 5, -10, 2, 2, BARRELS),
  // The South Yard (spawn 2).
  box("sandbags", -10.5, 11.5, 3, 1, SAND),
  box("crate", -9.5, 8.2, 2, 2, CRATE),
  box("sandbags", -4, 10, 5, 2, SAND),
  box("barrels", -2, 5.8, 2, 2, BARRELS),
  box("sandbags", -2, 14.3, 1, 3.4, SAND),
];

export const FORT: MapDef = {
  id: "fort",
  name: "Fort",
  blurb: "A brick blockhouse with a guardroom annex and four offset doors. Circle it, hold it, or grenade it.",
  halfX: HALF,
  halfZ: HALF,
  obstacles: OBSTACLES,
  spawns: [
    { x: -13.5, z: -12.5 },
    { x: 12.5, z: 13.5 },
    { x: -13.5, z: 13.5 },
    { x: 13.5, z: -13.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Debris_Papers_1", x: 12.1, z: 12.8, yaw: 5.9 },
    { prop: "WoodPlanks", x: -12.5, z: -7, yaw: 3 },
    { prop: "Debris_Papers_3", x: 12, z: 5.8, yaw: 0.1 },
    { prop: "Pallet_Broken", x: -7, z: 6.5, yaw: 4.9 },
    { prop: "Debris_Pile", x: 8, z: 7.5, yaw: 2.6 },
    { prop: "Debris_Papers_1", x: -3.5, z: 0.8, yaw: 1.5 },
    { prop: "WoodPlanks", x: -6.2, z: -14.4, yaw: 5.5 },
    { prop: "Debris_Papers_3", x: 13, z: -11.9, yaw: 2.5 },
    { prop: "Pallet_Broken", x: 8.7, z: 0.4, yaw: 0.7 },
    { prop: "Debris_Pile", x: -6.5, z: 14.7, yaw: 5.4 },
    { prop: "Debris_Papers_1", x: 3, z: -8, yaw: 6 },
    { prop: "WoodPlanks", x: 7.5, z: -13.6, yaw: 0.3 },
    // Outside the walls.
    { prop: "ExplodingBarrel", x: -3.8, z: -18.2, yaw: 5.1 },
    { prop: "TrafficCone", x: 18.1, z: -10.2, yaw: 3.8 },
    { prop: "CardboardBoxes_4", x: 1.3, z: 17.7, yaw: 3.1 },
    { prop: "CardboardBoxes_2", x: -17.7, z: -3.5, yaw: 4.2 },
    { prop: "ExplodingBarrel", x: -5.5, z: -17.7, yaw: 0.7 },
    { prop: "TrafficCone", x: 18, z: 9.3, yaw: 5.3 },
    { prop: "CardboardBoxes_4", x: 10.2, z: 18.4, yaw: 1.2 },
    { prop: "CardboardBoxes_2", x: -17.8, z: 12.5, yaw: 2.9 },
    { prop: "ExplodingBarrel", x: -5.4, z: -18.1, yaw: 0.6 },
    { prop: "TrafficCone", x: 18, z: -11.2, yaw: 1.1 },
    { prop: "CardboardBoxes_4", x: 12.4, z: 18.1, yaw: 4.3 },
    { prop: "CardboardBoxes_2", x: -18.1, z: -12, yaw: 2.9 },
    { prop: "ExplodingBarrel", x: -8.4, z: -17.7, yaw: 4 },
    { prop: "TrafficCone", x: 18.1, z: -11.8, yaw: 5.4 },
  ],
  theme: {
    floor: 0x8a6f55,
    grid: 0x9c8064,
    gridOpacity: 0.15,
    outerFloor: 0x4a3a2c,
    background: 0x20161a,
    wall: "brick",
    hemiSky: 0xffc9a0,
    hemiGround: 0x3a2a30,
    hemiIntensity: 1.15,
    sun: 0xffa866,
    sunIntensity: 2.4,
    sunDir: { x: -20, y: 12, z: 6 },
  },
  favours: ["rifle", "smg"],
};
