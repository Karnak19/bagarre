// Freight: a cargo port at dusk. The two halves are different places, not a
// mirror:
//
// - North, the Quay (the water is the north wall): a long, open strip along
//   the screen's X, the sniper lane. Two gantry cranes stand over it, legs on
//   the water's edge and on the landside rail; the only tall cargo sits flush
//   against the water, so nothing tall stands between the quay and the camera.
//   Behind the rail: the low brick Harbour Office (NW), an apron of loose
//   cargo, and two reefer containers standing end-on (NE).
// - South, the Container Yard (land side): dense and closed, behind a barrier
//   fence with five gates, each with a crate stack in front of it so you
//   can't see straight through. West of the middle, container rows and crate
//   stacks run along X; east of it, containers stand in columns along Z with
//   the truck bays between them. The Gate Road runs along the south wall, with
//   the gatehouse at its west end.
// - The Boulevard (|z| < 7) crosses the whole port, with the yard crane in the
//   middle (four legs round a hanging container): the hub.
//
// Teams: North Quay against Container Yard. The quay is open and its spawns
// sit at its edges; the yard is closed and some of its spawns sit in front of
// the fence to make up for it. Balance is measured, not mirrored (bun
// scripts/ffa/validate.ts freight): exposure, cover, walk to the hub,
// territory and the camera metrics per side. The camera looks from the +x/+z
// corner, so tall boxes on the quay stand flush against the water or end-on
// (the reefers), and the yard's containers face the hub with their +z side.
import { box, type Obstacle } from "../types.ts";
import type { FfaMapDef } from "./index.ts";

const HX = 31;
const HZ = 26;

// The yard crane over the Boulevard: the hub.
const CRANE: Obstacle[] = [
  box("container", -4.5, -4, 2, 2, 1.8),
  box("container", 4, -4, 2, 2, 1.8),
  box("container", 5, 5, 2, 2, 1.8),
  box("container", -4.5, 5, 2, 2, 1.8),
  box("container", 0.5, 0.5, 3, 2, 1.8), // the load on the hook
];

// North: the Quay, water at z = -26. The lane (z -24.5..-15) stays clear.
const QUAY: Obstacle[] = [
  // Against the water: two container stacks waiting for the ship, bollards.
  box("container", 24, -25, 8, 2, 1.8),
  box("container", -2, -25, 6, 2, 1.8),
  box("barrels", -23.5, -25.5, 1, 1, 1.1),
  box("barrels", -13, -25.5, 1, 1, 1.1),
  box("barrels", 10.5, -25.5, 1, 1, 1.1),
  // Crane One (west): seaside legs on the water's edge, landside legs on the office wall.
  box("container", -27, -25.25, 1.5, 1.5, 1.8),
  box("container", -20, -25.25, 1.5, 1.5, 1.8),
  box("container", -27, -14.25, 1.5, 1.5, 1.8),
  box("container", -20, -14.25, 1.5, 1.5, 1.8),
  // Crane Two (east), with a pallet between its landside legs.
  box("container", 7, -25.25, 1.5, 1.5, 1.8),
  box("container", 14, -25.25, 1.5, 1.5, 1.8),
  box("container", 7, -14.5, 1.5, 1.5, 1.8),
  box("container", 14, -14.5, 1.5, 1.5, 1.8),
  box("crate", 10.5, -14.5, 2, 1, 1.2),
  // Cargo along the landside rail, and the west end of the quay.
  box("crate", -29, -19, 4, 2, 1.2),
  box("barrels", -25, -21.5, 1, 1, 1.1),
  box("crate", -13, -14.5, 3, 2, 1.2),
  box("crate", -8.5, -16, 1, 2, 1.2),
  box("barrier", -3, -14, 6, 1, 1.2),
  box("crate", 3.5, -14, 2, 1, 1.2),
];

// North, behind the rail: the Harbour Office, the Apron, the reefers.
const APRON: Obstacle[] = [
  // Harbour Office (NW): low brick, a door north, open to the Boulevard.
  box("wall", -27, -13, 8, 1, 1.3),
  box("wall", -20, -13, 2, 1, 1.3),
  box("wall", -19.5, -10, 1, 5, 1.3),
  box("crate", -25, -9.5, 2, 2, 1.2),
  // Apron: loose cargo.
  box("crate", -11, -11, 5, 1, 1.2),
  box("crate", 1.5, -10, 3, 2, 1.2),
  box("crate", 12, -11, 2, 2, 1.2),
  box("barrels", 16.5, -10, 1.5, 1.5, 1.1),
  box("crate", 8.5, -6.5, 3, 2, 1.2),
  // Reefers (NE), end-on to the quay.
  box("container", 21, -11, 2, 6, 1.8),
  box("container", 26, -12, 2, 6, 1.8),
];

// The Boulevard. The band z -3..2 stays clear end to end (the second long lane).
const BOULEVARD: Obstacle[] = [
  // North side.
  box("barrier", -24, -4, 3, 1, 1.2),
  box("sandbags", -15, -3.5, 3, 1, 1.1),
  box("sandbags", -13.5, -7, 3, 1, 1.1),
  box("crate", -9, -4.5, 2, 2, 1.2),
  box("barrels", 13, -4.5, 2, 2, 1.1),
  box("crate", 15, -5, 2, 2, 1.2),
  box("barrier", 20, -3.5, 8, 1, 1.2),
  box("barrels", 28, -6, 2, 2, 1.1),
  // South side: a crate stack in front of each yard gate, and two stacks
  // against the fence that cut the walk along it.
  box("crate", -21.5, 3, 3, 2, 1.2),
  box("crate", -9.5, 3, 3, 2, 1.2),
  box("crate", 10.5, 3, 3, 2, 1.2),
  box("crate", 19.5, 3, 3, 2, 1.2),
  box("crate", 26, 3, 2, 2, 1.5),
  box("crate", -15.5, 5, 2, 2, 1.2),
  box("crate", 15, 5.75, 2, 3.5, 1.2),
];

// South: the Container Yard behind its fence (gates at x -23..-20, -11..-8,
// -1..2, 9..12, 24..27.5). The east part of the fence steps back a metre.
const YARD: Obstacle[] = [
  // The fence.
  box("barrier", -27, 6.5, 8, 1, 1.2),
  box("barrier", -15.5, 6.5, 9, 1, 1.2),
  box("barrier", -4.5, 6.5, 7, 1, 1.2),
  box("barrier", 5.5, 6.5, 7, 1, 1.2),
  box("barrier", 18, 8, 12, 1, 1.2),
  box("barrier", 29.25, 8, 3.5, 1, 1.2),
  // West: container rows and crate stacks along X, one stack against the west wall.
  box("container", -25, 10, 6, 2, 1.8),
  box("container", -17, 10, 6, 2, 1.8),
  box("crate", -22, 14, 6, 2, 1.2),
  box("crate", -12.5, 14, 4, 2, 1.2),
  box("crate", -17, 18, 6, 2, 1.2),
  box("container", -30, 17, 2, 6, 1.8),
  // The middle: a long divider (a crate, a container, a crate) from the fence
  // towards the Gate Road, and the truck lane east of it.
  box("crate", -7, 8, 2, 2, 1.2),
  box("container", -7, 12.25, 2, 6.5, 1.8),
  box("crate", -7, 17, 2, 3, 1.2),
  box("crate", -1, 11, 3, 2, 1.2),
  box("container", 2.5, 15.5, 4, 2, 1.8),
  box("barrier", 6.5, 19, 4, 1, 1.2),
  // East: containers in columns along Z, crate stacks between the truck bays.
  box("container", 14, 11.75, 2, 6.5, 1.8),
  box("container", 19, 16, 2, 6, 1.8),
  box("crate", 24, 10.25, 3, 3.5, 1.2),
  box("crate", 25.5, 13.75, 3, 3.5, 1.2),
  box("crate", 25.5, 20, 3, 2, 1.2),
];

// South edge: the Gate Road, the gatehouse at its west end, a parked truck.
const GATE_ROAD: Obstacle[] = [
  box("wall", -23, 22, 8, 1, 1.3),
  box("wall", -19.5, 24.25, 1, 3.5, 1.3),
  box("crate", -10, 22.5, 2, 2, 1.2),
  box("crate", -3.5, 20.5, 2, 2, 1.2),
  box("barrels", -5, 25, 1.5, 2, 1.1),
  box("container", 8, 23, 6, 2, 1.8),
  box("barrier", 20.5, 22.5, 4, 1, 1.2),
];

export const FREIGHT: FfaMapDef = {
  id: "freight",
  name: "Freight",
  blurb: "A cargo port at dusk: an open quay on the water under two cranes, a fenced container yard inland, a crane in the middle.",
  mode: "ffa",
  players: { min: 3, max: 6 },
  halfX: HX,
  halfZ: HZ,
  obstacles: [...CRANE, ...QUAY, ...APRON, ...BOULEVARD, ...YARD, ...GATE_ROAD],
  // Even spawns on the north side (the Quay team), odd ones on the south
  // (the Yard team). Not mirrored pairs: each side's spots are its own.
  spawns: [
    { x: -28.5, z: -21 }, // 0 west end of the quay, behind the cargo
    { x: 28, z: 15.5 }, // 1 east truck bay
    { x: 28.5, z: -13.5 }, // 2 behind the east reefer
    { x: -17.5, z: 24 }, // 3 Gate Road, by the gatehouse
    { x: -27, z: -10 }, // 4 inside the Harbour Office
    { x: -27, z: 17 }, // 5 west stacks, by the wall stack
    { x: -13.5, z: -8.5 }, // 6 Apron, west
    { x: 2.5, z: 20.5 }, // 7 truck lane, south end
    { x: 10, z: -11.5 }, // 8 Apron, east
    { x: -6.5, z: 21 }, // 9 Gate Road, by the divider
    { x: 24, z: -5 }, // 10 Boulevard, east, behind the barrier
    { x: 16.5, z: 15.5 }, // 11 between the east columns
    { x: -7, z: -14 }, // 12 landside rail, by the barrier
    { x: 15.5, z: 3 }, // 13 Boulevard, south, by the fence
    { x: 18.5, z: -12 }, // 14 by the west reefer
    { x: -17.5, z: 5 }, // 15 Boulevard, south, by the fence
  ],
  hub: { x: 0, z: 0 },
  teams: [
    { name: "North Quay", spawns: [0, 2, 4, 6, 8, 10, 12, 14] },
    { name: "Container Yard", spawns: [1, 3, 5, 7, 9, 11, 13, 15] },
  ],
  zones: [
    { id: "crane", name: "Crane", x0: -8, z0: -7, x1: 8, z1: 7, tint: 0xf0c040 },
    { id: "quay", name: "Quay", x0: -31, z0: -26, x1: 31, z1: -13, tint: 0x4a7a9a },
    { id: "office", name: "Harbour Office", x0: -31, z0: -13, x1: -19, z1: -7, tint: 0xa2503c },
    { id: "reefers", name: "Reefers", x0: 18, z0: -16, x1: 31, z1: -7, tint: 0x4f7fb3 },
    { id: "apron", name: "Apron", x0: -19, z0: -13, x1: 18, z1: -7, tint: 0xb9823f },
    { id: "boulevard", name: "Boulevard", x0: -31, z0: -7, x1: 31, z1: 7, tint: 0x777777 },
    { id: "stacks", name: "Container Stacks", x0: -31, z0: 7, x1: -6, z1: 20, tint: 0x4f7fb3 },
    { id: "bays", name: "Truck Bays", x0: -6, z0: 7, x1: 31, z1: 20, tint: 0xa7a9a3 },
    { id: "gate", name: "Gate Road", x0: -31, z0: 20, x1: 31, z1: 26, tint: 0x8c8c8c },
  ],
  landmarks: [
    { name: "Crane", x: 0, z: 0 },
    { name: "Crane One", x: -23.5, z: -19.75 },
    { name: "Crane Two", x: 10.5, z: -20 },
    { name: "Harbour Office", x: -24, z: -10 },
    { name: "Reefers", x: 23.5, z: -11.5 },
    { name: "Gatehouse", x: -23, z: 24 },
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
