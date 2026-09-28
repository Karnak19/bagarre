// Scrapyard: a junkyard at sunset, really lopsided. Not mirrored: balance is
// measured (scripts/analyze.ts, "Fairness" in docs/maps.md).
//
// - West, the Heap (slot 0's side, bottom-left of the plan): a maze of low junk
//   walls (sandbags, barriers, brick) on a 3 m grid with 2 m alleys. Cover
//   everywhere, short sightlines, slow to cross. SMG and shotgun.
// - East, the Lot (slot 1's side, top-right): open ground with a few big
//   wrecks (three containers, a crate pile, two brick stubs in the middle) and a
//   sandbag shelter at the start. Long lanes between the wrecks. Rifle.
//
// The two starts sit at the screen's left and right ends (-x/+z and +x/-z),
// so both players take cover on faces the camera sees the same way.
import { ascii, type MapDef } from "./types.ts";

const HX = 17;
const HZ = 15;

//   C = container (1.8 m), c = crates (1.5 m), s = sandbags (1.1 m), b = barrier (1.2 m), o = barrels (1.1 m), w = wall (1.4 m)
const PLAN = [
  //0         1         2         3
  //0123456789012345678901234567890123
  "...........................s......", // 0
  "...........................s......", // 1
  ".........oooo..............s......", // 2
  "...cc....oooo.....................", // 3
  "...cc....oooo......CCCCCC.........", // 4
  "...................CCCCCC..sssss..", // 5
  "...................CCCCCC.........", // 6
  "...................CCCCCC.........", // 7
  "......o...........................", // 8
  "......o.........................oo", // 9
  "..sssso...c.....................oo", // 10
  "......o...cbbbbb..........CC......", // 11
  "..........cbbbbb..........CC......", // 12
  "...............w..........CC......", // 13
  "...............w..w.......CC......", // 14
  "..w....ssssss.....w.......CC......", // 15
  "..w...............w...............", // 16
  "..w...............................", // 17
  "..w........ssss...................", // 18
  "..w.....b.........................", // 19
  "..wss...b.............ccccc.......", // 20
  "..w.....b..w..........ccccc.......", // 21
  "........b..w......................", // 22
  "........b..w......................", // 23
  "...bbb.....w.............CCCCC....", // 24
  "...........wssb..........CCCCC....", // 25
  "...........w..b..........CCCCC....", // 26
  ".....sss...w..b...................", // 27
  "..................................", // 28
  "..................................", // 29
];

export const SCRAPYARD: MapDef = {
  id: "scrapyard",
  name: "Scrapyard",
  blurb: "Junk at sunset: a maze of low scrap walls on one side, open ground and big wrecks on the other.",
  halfX: HX,
  halfZ: HZ,
  obstacles: ascii(HX, HZ, PLAN, {
    C: { kind: "container", h: 1.8 },
    c: { kind: "crate", h: 1.5 },
    s: { kind: "sandbags", h: 1.1 },
    b: { kind: "barrier", h: 1.2 },
    o: { kind: "barrels", h: 1.1 },
    w: { kind: "wall", h: 1.4 },
  }),
  spawns: [
    { x: -14.5, z: 11.5 },
    { x: 13.5, z: -12 },
    { x: -6.5, z: 14 },
    { x: 8, z: -13.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Debris_Pile", x: -11, z: -8, yaw: 4 },
    { prop: "Pallet_Broken", x: -2, z: -12, yaw: 0.3 },
    { prop: "WoodPlanks", x: 3, z: -5, yaw: 2.2 },
    { prop: "Debris_Pile", x: 13, z: 3, yaw: 5.8 },
    { prop: "Debris_Papers_2", x: 0, z: 8, yaw: 2.4 },
    { prop: "Pallet_Broken", x: -8, z: 11, yaw: 2.2 },
    { prop: "Debris_Pile", x: -12, z: 1, yaw: 3 },
    { prop: "WoodPlanks", x: 6, z: 12, yaw: 4 },
    { prop: "Debris_Papers_2", x: -2, z: 5, yaw: 3.3 },
    { prop: "Pallet_Broken", x: 15, z: -12, yaw: 0.5 },
    { prop: "WoodPlanks", x: -15, z: -12, yaw: 0.4 },
    { prop: "Debris_Pile", x: 0, z: -7, yaw: 1.2 },
    { prop: "Debris_Papers_2", x: -6, z: -8, yaw: 1.1 },
    { prop: "Pallet_Broken", x: 14, z: -4, yaw: 5 },
    { prop: "Debris_Pile", x: -11, z: -1, yaw: 0.1 },
    { prop: "WoodPlanks", x: 4, z: 3, yaw: 3.8 },
    // Outside the walls.
    { prop: "Debris_Tires", x: 8.4, z: -17.3, yaw: 4 },
    { prop: "ExplodingBarrel", x: 18.9, z: -10.6, yaw: 4.8 },
    { prop: "CardboardBoxes_4", x: 1, z: 16.8, yaw: 1.3 },
    { prop: "Debris_Tires", x: -19.2, z: 11.2, yaw: 5.4 },
    { prop: "CardboardBoxes_1", x: 10.2, z: -17.3, yaw: 1 },
    { prop: "Debris_Tires", x: 19.2, z: -5.3, yaw: 2.3 },
    { prop: "ExplodingBarrel", x: -13.7, z: 17.3, yaw: 4.9 },
    { prop: "CardboardBoxes_4", x: -19, z: 2.8, yaw: 4.8 },
    { prop: "Debris_Tires", x: 5.8, z: -17.3, yaw: 4.4 },
    { prop: "CardboardBoxes_1", x: 18.7, z: -6.5, yaw: 1.1 },
    { prop: "Debris_Tires", x: 6.3, z: 17.3, yaw: 2.4 },
    { prop: "ExplodingBarrel", x: -19.3, z: -9.5, yaw: 3.1 },
    { prop: "CardboardBoxes_4", x: -9.3, z: -17.1, yaw: 3.2 },
    { prop: "Debris_Tires", x: 18.8, z: 4.9, yaw: 2.7 },
    { prop: "CardboardBoxes_1", x: -1.7, z: 16.8, yaw: 0 },
    { prop: "Debris_Tires", x: -19.2, z: 7.1, yaw: 0.5 },
  ],
  theme: {
    floor: 0x7a6250,
    grid: 0x8c7260,
    gridOpacity: 0.14,
    outerFloor: 0x3e2c24,
    background: 0x1f1418,
    wall: "brick",
    hemiSky: 0xffb38a,
    hemiGround: 0x3a2630,
    hemiIntensity: 1.2,
    sun: 0xff9a5c,
    sunIntensity: 2.3,
    sunDir: { x: 18, y: 10, z: -10 },
  },
  favours: ["smg", "shotgun", "rifle"],
};
