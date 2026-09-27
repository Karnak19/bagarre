// Dockside: three lanes split by rows of shipping containers, with gaps to
// cross between them. The middle lane is long and open, the outer lanes are
// cluttered flanks.
import { asciiPoint, type MapDef } from "./types.ts";

const HX = 18;
const HZ = 14;

//   C = container (1.8 m), c = crates (1.5 m), b = barrier (1.2 m), o = barrels (1.1 m)
const TOP = [
  //0         1         2         3
  //012345678901234567890123456789012345
  ".....oo..........cc..........cc.....", // 0
  ".....oo..........cc..........cc.....", // 1
  ".................cc.................", // 2
  ".........oo......cc.................", // 3
  ".........oo...........oo............", // 4
  ".............cc.....................", // 5
  ".............cc.....................", // 6
  "CCCCCCCCC...CCCCCCCCCCCC...CCCCCC...", // 7
  "CCCCCCCCC...CCCCCCCCCCCC...CCCCCC...", // 8
  "....................................", // 9
  "....................................", // 10
  ".........bbb............bbb.........", // 11
  "....................................", // 12
  ".................cc.................", // 13
];

export const DOCKSIDE: MapDef = {
  id: "dockside",
  name: "Dockside",
  blurb: "Night shift at the container docks: one long lane down the middle, two flanks behind the stacks.",
  halfX: HX,
  halfZ: HZ,
  symmetry: "point",
  obstacles: asciiPoint(HX, HZ, TOP, {
    C: { kind: "container", h: 1.8 },
    c: { kind: "crate", h: 1.5 },
    b: { kind: "barrier", h: 1.2 },
    o: { kind: "barrels", h: 1.1 },
  }),
  spawns: [
    { x: -16.5, z: -10.5 },
    { x: 16.5, z: 10.5 },
    { x: -16.5, z: 10.5 },
    { x: 16.5, z: -10.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Pallet", x: -13.3, z: -10.1, yaw: 0 },
    { prop: "Debris_Papers_2", x: -15.7, z: 1.7, yaw: 0.7 },
    { prop: "WoodPlanks", x: 13.6, z: -8.9, yaw: 2.1 },
    { prop: "Pallet_Broken", x: 8.6, z: -12.6, yaw: 2.8 },
    { prop: "Pallet", x: -10.1, z: 10.9, yaw: 6.1 },
    { prop: "Pallet", x: -11.9, z: -3.4, yaw: 6.2 },
    { prop: "Debris_Papers_2", x: 13.3, z: 2.7, yaw: 5.5 },
    { prop: "WoodPlanks", x: 5.9, z: -0.7, yaw: 0.8 },
    { prop: "Pallet_Broken", x: 13.6, z: -2.5, yaw: 2 },
    { prop: "Pallet", x: 3.1, z: 3.8, yaw: 4.9 },
    { prop: "Pallet", x: 1.6, z: -2.3, yaw: 0 },
    { prop: "Debris_Papers_2", x: -8.5, z: 0.2, yaw: 2.3 },
    { prop: "WoodPlanks", x: 6, z: 11.4, yaw: 1.9 },
    { prop: "Pallet_Broken", x: 14, z: 10.1, yaw: 2.3 },
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
