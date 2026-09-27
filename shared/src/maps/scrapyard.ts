// Scrapyard: a junkyard that looks lopsided but isn't. The collision is
// point-symmetric; each side is dressed with different props of the same
// footprint and height (crates on one side are a container on the other...).
import { asciiPoint, type MapDef } from "./types.ts";

const HX = 17;
const HZ = 15;

//   C = container (1.8 m), c = crates (1.5 m), s = sandbags (1.1 m), b = barrier (1.2 m), o = barrels (1.1 m), w = wall (1.4 m)
const TOP = [
  //0         1         2         3
  //0123456789012345678901234567890123
  ".........................CCCCC....", // 0
  ".........................CCCCC....", // 1
  ".......ooo........................", // 2
  ".....................ss...........", // 3
  "..................................", // 4
  "....bbbb..........................", // 5
  "...........cc.......CCC...........", // 6
  "...........cc.......CCC...........", // 7
  "...ww.............................", // 8
  "...ww.............................", // 9
  "...ww............ccc.....ss..oo...", // 10
  "wwww.............ccc.........oo...", // 11
  ".........cc.......................", // 12
  ".........cc.......................", // 13
  "................oo..........ssss..", // 14
];

export const SCRAPYARD: MapDef = {
  id: "scrapyard",
  name: "Scrapyard",
  blurb: "Piles of junk at sunset. Looks lopsided; every pile has a twin, dressed differently.",
  halfX: HX,
  halfZ: HZ,
  symmetry: "point",
  obstacles: asciiPoint(HX, HZ, TOP, {
    C: { kind: "container", h: 1.8 },
    c: { kind: "crate", h: 1.5 },
    s: { kind: "sandbags", h: 1.1 },
    b: { kind: "barrier", h: 1.2 },
    o: { kind: "barrels", h: 1.1 },
    w: { kind: "wall", h: 1.4 },
  }, {
    // The rotated half wears different props: same boxes, different junk.
    reskin: { container: "crate", crate: "container", barrier: "sandbags", sandbags: "barrier", barrels: "crate" },
  }),
  spawns: [
    { x: -14.5, z: -12.5 },
    { x: 14.5, z: 12.5 },
    { x: -15.5, z: 6.5 },
    { x: 15.5, z: -6.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Pallet_Broken", x: 11, z: 3.8, yaw: 5 },
    { prop: "WoodPlanks", x: -14.7, z: -8.6, yaw: 0.4 },
    { prop: "Debris_Pile", x: -12.5, z: -1, yaw: 4 },
    { prop: "Debris_Papers_2", x: 9.2, z: 7.9, yaw: 2.4 },
    { prop: "Debris_Pile", x: -11, z: 7, yaw: 3 },
    { prop: "Pallet_Broken", x: 0.5, z: -7, yaw: 0.3 },
    { prop: "WoodPlanks", x: 8.4, z: -6.3, yaw: 2.2 },
    { prop: "Debris_Pile", x: -4.4, z: -2.6, yaw: 0.1 },
    { prop: "Debris_Papers_2", x: 2.1, z: 11.4, yaw: 3.3 },
    { prop: "Debris_Pile", x: -4.2, z: 3.6, yaw: 3.8 },
    { prop: "Pallet_Broken", x: -4, z: -13.7, yaw: 0.5 },
    { prop: "WoodPlanks", x: -2.1, z: 9.3, yaw: 4 },
    { prop: "Debris_Pile", x: 12.7, z: 11.7, yaw: 5.8 },
    { prop: "Debris_Papers_2", x: 4.1, z: -10, yaw: 1.1 },
    { prop: "Debris_Pile", x: 5.2, z: -1.2, yaw: 1.2 },
    { prop: "Pallet_Broken", x: -9.3, z: -6.8, yaw: 2.2 },
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
