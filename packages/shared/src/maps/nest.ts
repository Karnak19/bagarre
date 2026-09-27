// Nest: king of the hill. A lopsided sandbag nest in the middle that both
// players race for, and two approaches that do not look alike: screen-left
// (spawns 0 and 2) creeps up a long covered sandbag trench, screen-right
// (spawns 1 and 3) hops between low crate stacks across open ground. Not
// mirrored: the sides are balanced by measurement (scripts/analyze.ts
// `fairness`), including what the iso camera hides.
import { box, type MapDef } from "./types.ts";

const HALF = 15;

const OBSTACLES = [
  // The nest. Closed at the top of the screen (a sandbag wall meeting a
  // barrier), open three ways, none alike: a wide gap at the screen-left
  // corner where the trench arrives, and two narrow slots on the screen-right
  // side, one on each side of a crate block.
  box("sandbags", -4, -0.5, 1, 7, 1.1), // west wall
  box("barrier", -1.15, -3.5, 4.7, 1, 1.2), // north wall
  box("crate", 3.75, -1, 1.5, 3, 1.2), // east block
  box("sandbags", 4, 2.8, 1, 1.4, 1.1), // east stub
  box("sandbags", 1.25, 4, 5.5, 1, 1.1), // south wall
  box("crate", 0, 0.3, 1.2, 1.2, 1.5), // the nest's inner block

  // Screen-left: the trench, two sandbag lines from the spawn towards the
  // nest's open corner. Its top wall stops short of the outer wall so the
  // spawn side is not walled in.
  box("sandbags", -9.1, 6.5, 8.2, 1, 1.1),
  box("sandbags", -6.3, 9.7, 4.6, 1, 1.1),
  box("container", -11.2, 12.4, 1.6, 1.6, 1.8), // spawn shelter, splits spawns 0 and 2

  // Screen-right: stepping stones, low crates about a dash apart.
  box("crate", 13.5, -12.1, 3, 1, 1.5), // spawn shelter, splits spawns 1 and 3
  box("barrier", 13.5, -7.5, 3, 1, 1.2),
  box("crate", 8.2, -9, 1.5, 1.5, 1.2),
  box("crate", 4.4, -6.6, 2, 1.5, 1.2),
  box("crate", 9.8, -5.3, 1.5, 2, 1.2),
  box("crate", 9.6, -12.1, 1.5, 1.5, 1.2),

  // Flanks. Top of the screen: a container block, a barrier stub on the left
  // wall and a crate stack on the top wall (they cut the long edge lanes).
  // Bottom: a sandbag line, a sandbag stub on the bottom wall, barrels.
  box("container", -3.8, -9.5, 4, 2, 1.8),
  box("barrier", -13.5, -1.5, 3, 1, 1.2),
  box("crate", -0.5, -14, 2, 2, 1.2),
  box("sandbags", 4.4, 8.4, 4, 1, 1.1),
  box("sandbags", -0.1, 13, 1, 4, 1.1),
  box("barrels", 12.2, 11, 2, 2, 1.1),
];

export const NEST: MapDef = {
  id: "nest",
  name: "Nest",
  blurb: "One lopsided sandbag nest in a cold field: one side creeps up a trench, the other hops between crates.",
  halfX: HALF,
  halfZ: HALF,
  obstacles: OBSTACLES,
  spawns: [
    { x: -13.5, z: 11.4 },
    { x: 14, z: -10.7 },
    { x: -9.4, z: 14 },
    { x: 12, z: -13.9 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Debris_Pile", x: -7.2, z: -12, yaw: 2.1 },
    { prop: "Debris_Papers_3", x: -3.6, z: 6.4, yaw: 5.5 },
    { prop: "WoodPlanks", x: -5.2, z: 12, yaw: 0.7 },
    { prop: "Debris_Papers_1", x: -9.4, z: 8.1, yaw: 3.5 },
    { prop: "Debris_Pile", x: 5.2, z: -13.6, yaw: 1.5 },
    { prop: "Debris_Papers_3", x: 4.7, z: -5.3, yaw: 4.9 },
    { prop: "WoodPlanks", x: 1.5, z: 9.8, yaw: 1.6 },
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
