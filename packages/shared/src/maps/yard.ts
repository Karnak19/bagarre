// Yard: the original arena and the default map, rebuilt without mirroring.
// Still sparse and open. Each corner has its own kind of cover: the Trench
// (two low sandbag lines) around spawn 0 in the north-west, the Pen (a
// container and a long sandbag line) around spawn 1 in the south-east,
// barrels and a barrier stub in the north-east, one barrier in the
// south-west, and the crate stack a step north of the centre.
//
// The smoke tests walk straight lines on this map, so a few things are kept
// on purpose: spawns 0/1 at (-12,-12) and (12,12), the z = -12 row clear from
// x = -12 to the east wall, the x = 12 and x = 14.5 columns clear, the Pen's
// sandbag line with its west face at x = 6.5 across z = 4 (it stops a dash),
// and spawn 1 hidden from (0,-12) and the farthest spawn from it.
import { box, type MapDef } from "./types.ts";

export const YARD: MapDef = {
  id: "yard",
  name: "Yard",
  blurb: "The old training yard: open ground, a crate stack near the middle and a different bit of cover in every corner.",
  halfX: 15,
  halfZ: 15,
  obstacles: [
    // North-west (spawn 0): the Trench, two low sandbag lines.
    box("sandbags", -12.4, -9.75, 5.2, 1, 1.1),
    box("sandbags", -5.25, -7.75, 5.25, 1, 1.1),
    // The crate stack, a step north of the centre.
    box("crate", -2.75, -3.25, 3, 3, 1.5),
    // South-east (spawn 1): the Pen, a container and a long sandbag line.
    box("container", 9.25, 11.5, 3, 2, 1.8),
    box("sandbags", 7, 5.25, 1, 6.25, 1.2),
    // North-east (spawn 3): barrels and a barrier stub.
    box("barrels", 5.75, -9.75, 2, 2, 1.2),
    box("barrels", 3.25, -3.75, 1.5, 1.5, 1.2),
    box("barrier", 10.2, -4.25, 2.4, 1, 1.2),
    // South-west (spawn 2): one barrier.
    box("barrier", -7, 9.25, 4, 1, 1.2),
  ],
  spawns: [
    { x: -12, z: -12 },
    { x: 12, z: 12 },
    { x: -12, z: 11 },
    { x: 10.75, z: -10 },
  ],
  decor: [
    { prop: "Debris_Papers_1", x: -0.5, z: 0.5, yaw: 0.4 },
    { prop: "Debris_Papers_2", x: 3.5, z: 3, yaw: 2.1 },
    { prop: "Debris_Papers_3", x: -10.5, z: 2.5, yaw: 1.2 },
    { prop: "Debris_Papers_1", x: 10, z: -2, yaw: 3.3 },
    { prop: "Debris_Papers_3", x: 1.5, z: 11.5, yaw: 0.2 },
    { prop: "Debris_Papers_2", x: -1, z: -11.8, yaw: 4.1 },
    { prop: "Debris_Pile", x: -12.6, z: -3.5, yaw: 0.6, scale: 0.9 },
    { prop: "Debris_Pile", x: 12.6, z: 3.5, yaw: 3.7, scale: 0.9 },
    { prop: "Pallet", x: -12.8, z: 6.5, yaw: 0.3 },
    { prop: "Pallet_Broken", x: 12.8, z: -6.5, yaw: 2.0 },
    { prop: "WoodPlanks", x: 6.5, z: 10.5, yaw: 1.1 },
    { prop: "WoodPlanks", x: -6.5, z: -10.5, yaw: 2.4 },
    // Outside the walls (wall outer face at 15.6).
    { prop: "TrafficCone", x: -16.5, z: -6, yaw: 0 },
    { prop: "TrafficCone", x: -16.5, z: -4.6, yaw: 0.7 },
    { prop: "TrafficCone", x: 16.5, z: 6, yaw: 0.2 },
    { prop: "TrafficCone", x: 16.9, z: 4.8, yaw: 1.3 },
    { prop: "TrafficCone", x: 5, z: 16.5, yaw: 0 },
    { prop: "TrafficCone", x: -5, z: -16.5, yaw: 0.9 },
    { prop: "Debris_Tires", x: -16.8, z: 9, yaw: 0.5 },
    { prop: "Debris_Tires", x: 16.8, z: -9, yaw: 2.5 },
    { prop: "ExplodingBarrel", x: 9, z: -16.7, yaw: 0 },
    { prop: "ExplodingBarrel", x: 9.9, z: -16.8, yaw: 0.8 },
    { prop: "ExplodingBarrel", x: -9, z: 16.7, yaw: 0.3 },
    { prop: "CardboardBoxes_2", x: -11, z: -16.8, yaw: 0.2 },
    { prop: "CardboardBoxes_4", x: 11, z: 16.9, yaw: 2.8 },
    { prop: "CardboardBoxes_1", x: -16.7, z: 12, yaw: 1.4 },
    { prop: "CardboardBoxes_1", x: 16.7, z: -12, yaw: 4.2 },
    { prop: "Pallet", x: 0, z: 17.5, yaw: 0.1 },
    { prop: "Pallet", x: 0.3, z: -17.5, yaw: 1.7 },
  ],
  theme: {
    floor: 0x5f6570,
    grid: 0x6d7380,
    gridOpacity: 0.18,
    outerFloor: 0x3a3e46,
    background: 0x1a1d24,
    wall: "brick",
    hemiSky: 0xdde6ff,
    hemiGround: 0x3a3228,
    hemiIntensity: 1.25,
    sun: 0xfff4e0,
    sunIntensity: 2.3,
    sunDir: { x: 12, y: 25, z: 6 },
  },
  favours: ["rifle", "smg"],
};
