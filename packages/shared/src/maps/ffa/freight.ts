// Freight: a cargo pier at dusk, water on both long sides. Quays along the
// water (long, open lanes along the screen's X), a maze of container rows, a
// brick warehouse, and a gantry crane over the middle of the boulevard.
//
// Point-symmetric collision; the south-west half is dressed differently (the
// Warehouse comes back as a sandbagged Fuel Depot, the container Yard as
// crate Stacks), so the two halves read as different places.
import { box, symmetric, type Obstacle } from "../types.ts";
import type { FfaMapDef } from "./index.ts";

const HX = 31;
const HZ = 26;

// The north half (z < 0). Plan along z: quay -26..-19, yard and warehouse
// -19..-7, boulevard -7..7 through the middle.
const HALF: Obstacle[] = [
  // North quay: cargo left on the dock.
  box("crate", -24, -25, 3, 2, 1.5),
  box("barrels", -12, -25.25, 1.5, 1.5, 1.1),
  box("crate", 4, -25, 3, 2, 1.5),
  box("barrels", 16, -25.25, 1.5, 1.5, 1.1),
  box("crate", 25, -25, 3, 2, 1.5),

  // Container Yard (NW): three staggered rows, 2 m aisles.
  box("container", -25, -18, 6, 2, 1.8),
  box("container", -17, -18, 6, 2, 1.8),
  box("container", -10.5, -18, 3, 2, 1.8),
  box("container", -23, -14, 6, 2, 1.8),
  box("container", -15, -14, 6, 2, 1.8),
  box("container", -25, -10, 6, 2, 1.8),
  box("container", -17, -10, 6, 2, 1.8),
  box("container", -10.5, -10, 3, 2, 1.8),

  // Warehouse (NE): brick shell with five doors, crate stacks inside.
  box("wall", 12.5, -18.5, 7, 1, 1.3),
  box("wall", 23.5, -18.5, 9, 1, 1.3),
  box("wall", 11, -7.5, 4, 1, 1.3),
  box("wall", 19.5, -7.5, 7, 1, 1.3),
  box("wall", 27, -7.5, 2, 1, 1.3),
  box("wall", 9.5, -16.5, 1, 3, 1.3),
  box("wall", 9.5, -10, 1, 4, 1.3),
  box("wall", 27.5, -15.5, 1, 5, 1.3),
  box("wall", 27.5, -9, 1, 2, 1.3),
  box("crate", 14, -14.5, 2, 3, 1.5),
  box("crate", 19.5, -11.5, 3, 2, 1.5),
  box("crate", 24, -15, 2, 2, 1.5),

  // Truck lane between the Yard and the Warehouse.
  box("barrier", -4, -15, 4, 1, 1.2),
  box("barrier", 3, -11, 1, 4, 1.2),
  box("crate", 3, -18, 2, 2, 1.5),

  // Boulevard islands.
  box("crate", -19, -3.5, 2, 2, 1.5),
  box("sandbags", -12, -2, 1, 3, 1.1),
  box("barrier", 12, -3, 3, 1, 1.2),
  box("barrels", 21, -3.5, 2, 2, 1.1),
  box("barrier", -26.5, -2, 1, 3, 1.2),
  box("crate", 25.5, -4, 2, 2, 1.5),
];

export const FREIGHT: FfaMapDef = {
  id: "freight",
  name: "Freight",
  blurb: "A cargo pier at dusk: long quays on the water, container rows, a warehouse and a crane in the middle.",
  mode: "ffa",
  players: { min: 3, max: 6 },
  halfX: HX,
  halfZ: HZ,
  symmetry: "point",
  obstacles: [
    // The crane: four container legs round a cargo pallet, the landmark in the middle.
    box("container", -4, -4, 2, 2, 1.8),
    box("container", 4, -4, 2, 2, 1.8),
    box("container", 4, 4, 2, 2, 1.8),
    box("container", -4, 4, 2, 2, 1.8),
    box("crate", 0, 0, 2, 2, 1.5),
    ...symmetric("point", HALF, { container: "crate", wall: "sandbags", crate: "barrels" }),
  ],
  // In mirrored pairs (2k + 1 is the mirror of 2k): the quay ends, the Yard's
  // west aisle, the truck lane, the boulevard, and three inside the Warehouse
  // (which come back in the Fuel Depot).
  spawns: [
    { x: -27.5, z: -24.5 },
    { x: 27.5, z: 24.5 },
    { x: 28.5, z: -24.5 },
    { x: -28.5, z: 24.5 },
    { x: -27.5, z: -15.5 },
    { x: 27.5, z: 15.5 },
    { x: -3.5, z: -16.5 },
    { x: 3.5, z: 16.5 },
    { x: -18.5, z: -5.5 },
    { x: 18.5, z: 5.5 },
    { x: 11.5, z: -15.5 },
    { x: -11.5, z: 15.5 },
    { x: 21.5, z: -16.5 },
    { x: -21.5, z: 16.5 },
    { x: 17.5, z: -9.5 },
    { x: -17.5, z: 9.5 },
  ],
  hub: { x: 0, z: 0 },
  // Team deathmatch: the north half (North Quay, Yard, Warehouse: the even
  // spawns) against the south half (the odd ones, their mirrors).
  teams: [
    { name: "North Quay", spawns: [0, 2, 4, 6, 8, 10, 12, 14] },
    { name: "South Quay", spawns: [1, 3, 5, 7, 9, 11, 13, 15] },
  ],
  zones: [
    { id: "crane", name: "Crane", x0: -8, z0: -7, x1: 8, z1: 7, tint: 0xf0c040 },
    { id: "northquay", name: "North Quay", x0: -31, z0: -26, x1: 31, z1: -19, tint: 0x4a7a9a },
    { id: "southquay", name: "South Quay", x0: -31, z0: 19, x1: 31, z1: 26, tint: 0x4a7a9a },
    { id: "yard", name: "Container Yard", x0: -31, z0: -19, x1: -8, z1: -7, tint: 0x4f7fb3 },
    { id: "warehouse", name: "Warehouse", x0: 8, z0: -19, x1: 31, z1: -7, tint: 0xa2503c },
    { id: "stacks", name: "Crate Stacks", x0: 8, z0: 7, x1: 31, z1: 19, tint: 0xb9823f },
    { id: "fuel", name: "Fuel Depot", x0: -31, z0: 7, x1: -8, z1: 19, tint: 0xc8453a },
    { id: "northlane", name: "Truck Lane", x0: -8, z0: -19, x1: 8, z1: -7, tint: 0x8c8c8c },
    { id: "southlane", name: "Truck Lane", x0: -8, z0: 7, x1: 8, z1: 19, tint: 0x8c8c8c },
    { id: "boulevard", name: "Boulevard", x0: -31, z0: -7, x1: 31, z1: 7, tint: 0x777777 },
  ],
  landmarks: [
    { name: "Crane", x: 0, z: 0 },
    { name: "Warehouse", x: 18.5, z: -13 },
    { name: "Fuel Depot", x: -18.5, z: 13 },
  ],
  decor: [],
  theme: {
    floor: 0x5b6470,
    grid: 0x6d7784,
    gridOpacity: 0.2,
    outerFloor: 0x1c3a4e,
    background: 0x0e1a24,
    wall: "barrier",
    hemiSky: 0xffc9a0,
    hemiGround: 0x1d2a38,
    hemiIntensity: 1.0,
    sun: 0xffb27a,
    sunIntensity: 2.0,
    sunDir: { x: -16, y: 18, z: 10 },
  },
  favours: ["sniper", "rifle", "smg"],
};
