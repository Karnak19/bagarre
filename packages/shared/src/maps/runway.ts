// Runway: an abandoned desert airstrip. A long open strip down the middle
// with a few low islands, hangars on the aprons. The sniper's map.
import { asciiPoint, type MapDef } from "./types.ts";

const HX = 20;
const HZ = 14;

//   C = container / hangar (1.8 m), b = concrete barrier (1.2 m), s = sandbags (1.1 m)
const TOP = [
  //0         1         2         3
  //0123456789012345678901234567890123456789
  "......s..........................s......", // 0
  "......s..........................s......", // 1
  "......s....CCCCC.........CCCCC...s......", // 2
  "......s....CCCCC.........CCCCC...s......", // 3
  "......s....CCCCC.........CCCCC...s......", // 4
  "ssss................................ssss", // 5
  "........................................", // 6
  "........................................", // 7
  "........................................", // 8
  "........................................", // 9
  "........bb..................bb..........", // 10
  "..............bb........................", // 11
  "........................................", // 12
  "bbbbbb.............CC.............bbbbbb", // 13
];

export const RUNWAY: MapDef = {
  id: "runway",
  name: "Runway",
  blurb: "A long, bright airstrip with nowhere to hide for long. Sniper's paradise.",
  halfX: HX,
  halfZ: HZ,
  symmetry: "point",
  obstacles: asciiPoint(HX, HZ, TOP, {
    C: { kind: "container", h: 1.8 },
    b: { kind: "barrier", h: 1.2 },
    s: { kind: "sandbags", h: 1.1 },
  }),
  spawns: [
    { x: -17.5, z: -11.5 },
    { x: 17.5, z: 11.5 },
    { x: -17.5, z: 11.5 },
    { x: 17.5, z: -11.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Debris_Papers_2", x: 3.6, z: -5.1, yaw: 3.4 },
    { prop: "WoodPlanks", x: 18.3, z: 4.4, yaw: 3.3 },
    { prop: "Pallet", x: -16, z: 12.7, yaw: 1.3 },
    { prop: "Debris_Papers_3", x: -16.6, z: -3, yaw: 0.2 },
    { prop: "Debris_Papers_1", x: -16.1, z: 4.4, yaw: 5.8 },
    { prop: "Debris_Papers_2", x: 11.6, z: 6.2, yaw: 0.4 },
    { prop: "WoodPlanks", x: 4.4, z: -0.1, yaw: 1.3 },
    { prop: "Pallet", x: 11.4, z: -9.1, yaw: 0.2 },
    { prop: "Debris_Papers_3", x: -4.4, z: -5.1, yaw: 5 },
    { prop: "Debris_Papers_1", x: -5.5, z: 5.6, yaw: 3.7 },
    { prop: "Debris_Papers_2", x: -1.8, z: -10.8, yaw: 4.8 },
    { prop: "WoodPlanks", x: -11.2, z: -9.7, yaw: 5.3 },
    // Outside the walls.
    { prop: "TrafficCone", x: 3.5, z: -16.1, yaw: 5.9 },
    { prop: "TrafficCone", x: 22, z: -6, yaw: 2.5 },
    { prop: "ExplodingBarrel", x: 4.5, z: 16.1, yaw: 1.5 },
    { prop: "Debris_Tires", x: -22.1, z: -7.3, yaw: 0 },
    { prop: "CardboardBoxes_2", x: -7.4, z: -16.2, yaw: 4.8 },
    { prop: "TrafficCone", x: 21.9, z: -1.6, yaw: 3.2 },
    { prop: "TrafficCone", x: -8.4, z: 15.8, yaw: 5.3 },
    { prop: "ExplodingBarrel", x: -22.1, z: -5.2, yaw: 0.4 },
    { prop: "Debris_Tires", x: 12.8, z: -16.1, yaw: 2.8 },
    { prop: "CardboardBoxes_2", x: 22.3, z: -7.8, yaw: 1.8 },
    { prop: "TrafficCone", x: -9.5, z: 16, yaw: 4.9 },
    { prop: "TrafficCone", x: -21.6, z: -3.2, yaw: 2.6 },
    { prop: "ExplodingBarrel", x: -13.3, z: -16.4, yaw: 1.7 },
    { prop: "Debris_Tires", x: 22.1, z: 1.8, yaw: 5.6 },
    { prop: "CardboardBoxes_2", x: 7.5, z: 16.4, yaw: 1.6 },
    { prop: "TrafficCone", x: -22, z: -6.5, yaw: 2.5 },
  ],
  theme: {
    floor: 0xc8b48a,
    grid: 0xd8c69e,
    gridOpacity: 0.16,
    outerFloor: 0x9c8762,
    background: 0x2a2419,
    wall: "barrier",
    hemiSky: 0xfff3dc,
    hemiGround: 0x6d5a3c,
    hemiIntensity: 1.3,
    sun: 0xfff1d0,
    sunIntensity: 2.7,
    sunDir: { x: 4, y: 30, z: 3 },
  },
  favours: ["sniper", "rifle"],
};
