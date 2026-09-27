// Nest: king of the hill. A sandbag nest in the middle with four openings,
// open ground around it, and the spawns on the far left and right of the
// screen. Mirrored across the screen's vertical axis, so both players see
// the map exactly the same way.
import { box, spawnPairs, symmetric, type MapDef } from "./types.ts";

const HALF = 15;

// One side of the mirror (x, z) -> (z, x); `symmetric` adds the other.
const HALF_BOXES = [
  // The nest: four L corners around a 6 x 6 m pit, 2 m openings mid-side.
  box("sandbags", -2.5, 3.5, 3, 1, 1.1), // screen-left corner, both arms
  box("sandbags", -3.5, 2, 1, 2, 1.1),
  box("sandbags", -2.5, -3.5, 3, 1, 1.1), // screen-top corner, one arm (its mirror is the other)
  box("sandbags", 2.5, 3.5, 3, 1, 1.1), // screen-bottom corner, one arm
  // Approach cover, about a dash apart.
  box("crate", -7.5, 3, 2, 2, 1.5),
  box("barrier", -6, 9.5, 3, 1, 1.2),
  box("sandbags", 3, 10.5, 3, 1, 1.1),
  box("sandbags", -11, -1, 1, 3, 1.1),
  // Spawn shelter: a container and a sandbag wall between the two spawns of a side.
  box("container", -10.5, 10.5, 2, 2, 1.8),
  box("sandbags", -13, 11, 4, 1, 1.1),
  box("sandbags", -11.5, 4.5, 2, 1, 1.1),
];

export const NEST: MapDef = {
  id: "nest",
  name: "Nest",
  blurb: "One sandbag nest in the middle of a cold field. Take it, hold it, get grenaded out of it.",
  halfX: HALF,
  halfZ: HALF,
  symmetry: "mirrorDiag",
  obstacles: [
    ...symmetric("mirrorDiag", HALF_BOXES),
    // On the mirror axis: must be square.
    box("container", -8, -8, 3, 3, 1.8),
    box("barrels", 7, 7, 2, 2, 1.1),
  ],
  spawns: spawnPairs("mirrorDiag", [
    { x: -13.5, z: 13.5 },
    { x: -13.5, z: 8 },
  ]),
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Debris_Pile", x: -4.8, z: -9.1, yaw: 2.1 },
    { prop: "Debris_Papers_3", x: -3.6, z: 6.4, yaw: 5.5 },
    { prop: "WoodPlanks", x: -5.2, z: 12, yaw: 0.7 },
    { prop: "Debris_Papers_1", x: -9.4, z: 7.3, yaw: 3.5 },
    { prop: "Debris_Pile", x: 5.2, z: -13.6, yaw: 1.5 },
    { prop: "Debris_Papers_3", x: 4.7, z: -5.3, yaw: 4.9 },
    { prop: "WoodPlanks", x: 3.1, z: 8.6, yaw: 1.6 },
    { prop: "Debris_Papers_1", x: 11.6, z: 8.5, yaw: 4.3 },
    { prop: "Debris_Pile", x: 12, z: -3.7, yaw: 3.9 },
    { prop: "Debris_Papers_3", x: -9.4, z: -12.8, yaw: 2.6 },
    // Outside the walls.
    { prop: "Debris_Tires", x: 6.1, z: -17.1, yaw: 1.9 },
    { prop: "TrafficCone", x: 17.2, z: 10.9, yaw: 5.1 },
    { prop: "ExplodingBarrel", x: -6.2, z: 16.9, yaw: 3.8 },
    { prop: "Debris_Tires", x: -16.6, z: 3.3, yaw: 4.8 },
    { prop: "TrafficCone", x: -2.1, z: -16.8, yaw: 3.5 },
    { prop: "ExplodingBarrel", x: 16.7, z: -5.2, yaw: 0.3 },
    { prop: "Debris_Tires", x: -4.6, z: 16.9, yaw: 2.4 },
    { prop: "TrafficCone", x: -16.7, z: -8.5, yaw: 3.1 },
    { prop: "ExplodingBarrel", x: -9.5, z: -16.9, yaw: 2.5 },
    { prop: "Debris_Tires", x: 16.9, z: -3, yaw: 4.3 },
    { prop: "TrafficCone", x: -2.3, z: 16.8, yaw: 4.5 },
    { prop: "ExplodingBarrel", x: -17.2, z: 11.7, yaw: 1.3 },
  ],
  theme: {
    floor: 0x6f7f68,
    grid: 0x82937a,
    gridOpacity: 0.16,
    outerFloor: 0x3b4638,
    background: 0x151a17,
    wall: "sandbags",
    hemiSky: 0xd8e6ff,
    hemiGround: 0x2f3a2c,
    hemiIntensity: 1.3,
    sun: 0xf2f6ff,
    sunIntensity: 2.0,
    sunDir: { x: 10, y: 26, z: 10 },
  },
  favours: ["rifle", "shotgun"],
};
