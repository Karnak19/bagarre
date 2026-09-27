// Trenchworks: a sandbag trench network around a walled plaza. Short
// sightlines, lots of corners: shotgun and SMG country.
import { asciiPoint, type MapDef } from "./types.ts";

const HALF = 14;

// Top half of the floor, 1 m per character, row 0 is z = -14 (screen top-left
// edge). The bottom half is this rotated 180 degrees.
//   s = sandbag trench wall (1.1 m), w = brick wall (1.4 m), c = crates, o = barrels
const TOP = [
  //0         1         2
  //0123456789012345678901234567
  "...........s................", // 0
  "...........s................", // 1
  "...........s................", // 2
  "...sssss...s....s...sssss...", // 3
  ".......s........s...........", // 4
  ".......s........s...........", // 5
  ".......s........s...........", // 6
  ".......s...ssssssssss.......", // 7
  ".......s....................", // 8
  ".......s....................", // 9
  ".......s..oo.....o..........", // 10
  "ssss...s.........o..sssss...", // 11
  ".......s............s.......", // 12
  ".......s.....cc.....s.......", // 13
];

export const TRENCHWORKS: MapDef = {
  id: "trenchworks",
  name: "Trenchworks",
  blurb: "Mud, sandbags and blind corners around a walled plaza. Bring a shotgun.",
  halfX: HALF,
  halfZ: HALF,
  symmetry: "point",
  obstacles: asciiPoint(HALF, HALF, TOP, {
    s: { kind: "sandbags", h: 1.1 },
    w: { kind: "wall", h: 1.4 },
    c: { kind: "crate", h: 1.5 },
    o: { kind: "barrels", h: 1.1 },
  }),
  spawns: [
    { x: -12.5, z: -12.5 },
    { x: 12.5, z: 12.5 },
    { x: -12.5, z: 12.5 },
    { x: 12.5, z: -12.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Pallet_Broken", x: 11.4, z: 7.1, yaw: 3.2 },
    { prop: "WoodPlanks", x: -1, z: -4.2, yaw: 4.7 },
    { prop: "Debris_Pile", x: -8.2, z: -6.5, yaw: 2.1 },
    { prop: "Pallet", x: 4.1, z: 8.1, yaw: 1.5 },
    { prop: "Pallet", x: 10.5, z: -6.5, yaw: 4.3 },
    { prop: "Pallet_Broken", x: -9.8, z: 8.3, yaw: 2.1 },
    { prop: "WoodPlanks", x: -4.8, z: 5, yaw: 0.7 },
    { prop: "Debris_Pile", x: 12.4, z: -10.9, yaw: 3.7 },
    { prop: "Pallet", x: 10.1, z: -0.6, yaw: 2.7 },
    { prop: "Pallet", x: -4.5, z: -10.3, yaw: 1.4 },
    { prop: "Pallet_Broken", x: 4, z: -9.6, yaw: 5.4 },
    { prop: "WoodPlanks", x: -12.8, z: -9.7, yaw: 3.1 },
    { prop: "Debris_Pile", x: 3.5, z: 1.5, yaw: 5.4 },
    { prop: "Pallet", x: -4.4, z: 10.7, yaw: 3.1 },
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
