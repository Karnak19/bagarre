// Dockside: the container docks at night, three lanes split by broken rows of
// cargo, and the two halves are different yards. Not mirrored: balance is
// measured (scripts/analyze.ts, "Fairness" in docs/maps.md).
//
// - West, the Stacks (slot 0's side, bottom-left of the plan): tall containers
//   standing in rows and columns, narrow alleys, sight broken everywhere. SMG.
// - East, the Berth (slot 1's side, top-right): crate stacks, barrels and a
//   low barrier, with two containers waiting to be loaded. More, smaller cover.
// - Mid: the lane between the two cargo rows, a barrel pile in the middle.
//
// The two starts sit at the screen's left and right ends (-x/+z and +x/-z),
// so both players take cover on faces the camera sees the same way; the
// respawn pair is in the middle of each quay.
import { ascii, type MapDef } from "./types.ts";

const HX = 18;
const HZ = 14;

//   C = container (1.8 m), c = crates (1.5 m), b = barrier (1.2 m), o = barrels (1.1 m)
const PLAN = [
  //0         1         2         3
  //012345678901234567890123456789012345
  "....CC..........oo..................", // 0  z -14
  "....CC..........oo..................", // 1
  "....CC......c...oo............cc....", // 2
  "....CC......c.......CCCCCC....cc....", // 3
  "....CC..............CCCCCC..........", // 4
  "....................................", // 5
  "....................................", // 6
  "..........CCCCCC.........ccccc......", // 7
  "CCCCCC....CCCCCC...ccc...ccccc..cccc", // 8
  "CCCCCC.............ccc..........cccc", // 9
  "...................ccc..............", // 10
  "........b...............CCCCC.......", // 11
  "....c...b...............CCCCC.......", // 12
  "....c...b......ooo..................", // 13
  "....c...b......ooo..................", // 14 z 0
  ".......................c............", // 15
  "..............................ooo...", // 16
  "CCCC..........................ooo...", // 17
  "CCCC...CCCCCCC......................", // 18
  ".......CCCCCCC..cccc......c.........", // 19
  "................cccc......c...bbbbbb", // 20
  "....................................", // 21
  "....................................", // 22
  "....CCC.....CC.............oo.......", // 23
  "....CCC.....CC.........cc..oo.......", // 24
  "....CCC.....CC.........cc..oo.......", // 25
  "............CC.................cc...", // 26
  "............CC.................cc...", // 27 z 13
];

export const DOCKSIDE: MapDef = {
  id: "dockside",
  name: "Dockside",
  blurb: "Night shift at the container docks: tall stacks on one side, crates and barrels at the berth on the other, a lane in between.",
  halfX: HX,
  halfZ: HZ,
  obstacles: ascii(HX, HZ, PLAN, {
    C: { kind: "container", h: 1.8 },
    c: { kind: "crate", h: 1.5 },
    b: { kind: "barrier", h: 1.2 },
    o: { kind: "barrels", h: 1.1 },
  }),
  spawns: [
    { x: -16.5, z: 10.5 },
    { x: 16.5, z: -11.5 },
    { x: -8, z: 12.5 },
    { x: 7.5, z: -12 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Pallet", x: -9, z: -12, yaw: 0.3 },
    { prop: "WoodPlanks", x: -8, z: 2, yaw: 1.2 },
    { prop: "Pallet_Broken", x: 2, z: -8, yaw: 2.6 },
    { prop: "Pallet", x: 12, z: -1, yaw: 0.1 },
    { prop: "Debris_Papers_2", x: -2, z: 9, yaw: 4.1 },
    { prop: "WoodPlanks", x: 3, z: 1, yaw: 5.2 },
    { prop: "Pallet", x: -14, z: 8, yaw: 1.6 },
    { prop: "Pallet_Broken", x: 15, z: 9, yaw: 3.3 },
    { prop: "Debris_Papers_2", x: 10, z: -13, yaw: 0.8 },
    { prop: "WoodPlanks", x: -15, z: -9, yaw: 2.2 },
    { prop: "Pallet", x: 5, z: -0.5, yaw: 4.4 },
    { prop: "Debris_Papers_2", x: -3, z: -9, yaw: 5.9 },
    { prop: "Pallet_Broken", x: 16, z: 1, yaw: 1.1 },
    { prop: "WoodPlanks", x: -10, z: 13, yaw: 0.5 },
    // Outside the walls.
    { prop: "CardboardBoxes_4", x: 4.9, z: -15.8, yaw: 2 },
    { prop: "ExplodingBarrel", x: 20.2, z: 9.8, yaw: 3.5 },
    { prop: "TrafficCone", x: 3.8, z: 16, yaw: 2.4 },
    { prop: "CardboardBoxes_2", x: -19.9, z: -5, yaw: 6.2 },
    { prop: "CardboardBoxes_1", x: -14, z: -15.9, yaw: 4.8 },
    { prop: "CardboardBoxes_4", x: 20.3, z: -11.2, yaw: 4.6 },
    { prop: "ExplodingBarrel", x: 7.1, z: 15.9, yaw: 0.5 },
    { prop: "TrafficCone", x: -20, z: 2.7, yaw: 0.8 },
    { prop: "CardboardBoxes_2", x: -0.5, z: -15.7, yaw: 1.7 },
    { prop: "CardboardBoxes_1", x: 20.3, z: 8, yaw: 1.9 },
    { prop: "CardboardBoxes_4", x: -10.3, z: 15.8, yaw: 0.4 },
    { prop: "ExplodingBarrel", x: -20.1, z: 5.1, yaw: 4.2 },
    { prop: "TrafficCone", x: -5.1, z: -16, yaw: 0.2 },
    { prop: "CardboardBoxes_2", x: 20, z: -0.4, yaw: 2.2 },
    { prop: "CardboardBoxes_1", x: -15.1, z: 16.2, yaw: 2.5 },
    { prop: "CardboardBoxes_4", x: -19.9, z: -8.3, yaw: 3.1 },
  ],
  theme: {
    floor: 0x46505c,
    grid: 0x5a6674,
    gridOpacity: 0.2,
    outerFloor: 0x1d2a38,
    background: 0x0b1119,
    wall: "barrier",
    hemiSky: 0x9fb8ff,
    hemiGround: 0x1a2230,
    hemiIntensity: 1.0,
    sun: 0xbcd0ff,
    sunIntensity: 1.8,
    sunDir: { x: 10, y: 24, z: -12 },
  },
  favours: ["rifle", "smg"],
};
