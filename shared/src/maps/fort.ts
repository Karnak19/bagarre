// Fort: a brick blockhouse in the middle with a door on each side. Fight
// around it, through it, or lob grenades into it.
import { asciiPoint, type MapDef } from "./types.ts";

const HALF = 16;

//   w = brick wall (1.4 m), c = crates (1.5 m), s = sandbags (1.1 m), o = barrels (1.1 m)
const TOP = [
  //0         1         2         3
  //01234567890123456789012345678901
  "...............ww...............", // 0
  "...............ww...............", // 1
  "...............ww...............", // 2
  "...............ww...............", // 3
  "................................", // 4
  ".....ssss...............cc......", // 5
  ".....s..................cc......", // 6
  ".....s......sss.................", // 7
  "................................", // 8
  "................................", // 9
  "..........ww...wwwwwww..........", // 10
  "..........w..........w..........", // 11
  "..........w..............s......", // 12
  "..........w..............s......", // 13
  "..........w...cccc.......s......", // 14
  "wwww......w...cccc...w......wwww", // 15
];

export const FORT: MapDef = {
  id: "fort",
  name: "Fort",
  blurb: "A brick blockhouse around a crate keep, four doors in a pinwheel. Circle, hold, or grenade it.",
  halfX: HALF,
  halfZ: HALF,
  symmetry: "point",
  obstacles: asciiPoint(HALF, HALF, TOP, {
    w: { kind: "wall", h: 1.4 },
    c: { kind: "crate", h: 1.5 },
    s: { kind: "sandbags", h: 1.1 },
    o: { kind: "barrels", h: 1.1 },
  }),
  spawns: [
    { x: -13.5, z: -13.5 },
    { x: 13.5, z: 13.5 },
    { x: -13.5, z: 13.5 },
    { x: 13.5, z: -13.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Debris_Papers_1", x: 12.1, z: 12.8, yaw: 5.9 },
    { prop: "WoodPlanks", x: -12.2, z: -10.3, yaw: 3 },
    { prop: "Debris_Papers_3", x: 12.8, z: 4.4, yaw: 0.1 },
    { prop: "Pallet_Broken", x: -9.1, z: 7.4, yaw: 4.9 },
    { prop: "Debris_Pile", x: 6.7, z: 8.6, yaw: 2.6 },
    { prop: "Debris_Papers_1", x: -1.6, z: 3.5, yaw: 1.5 },
    { prop: "WoodPlanks", x: -6.2, z: -14.4, yaw: 5.5 },
    { prop: "Debris_Papers_3", x: 13, z: -11.9, yaw: 2.5 },
    { prop: "Pallet_Broken", x: 8.7, z: 0.4, yaw: 0.7 },
    { prop: "Debris_Pile", x: -6.5, z: 14.7, yaw: 5.4 },
    { prop: "Debris_Papers_1", x: 4, z: -8.9, yaw: 6 },
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
