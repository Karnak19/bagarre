// Runway: an abandoned desert airstrip, the sniper's map. Not mirrored, each
// end is its own place:
// - West (spawns 0 and 2): the Terminal, a container block on the north wall
//   with a walled forecourt around spawn 0 (its west face at x = -14 is the
//   wall the smoke test walks into), a jet bridge, parked baggage carts on
//   the apron and a long blast fence in front of the south-west revetment.
// - East (spawns 1 and 3): two open-fronted Hangars on the north wall (brick
//   shells sharing a middle wall, a tug parked in one), and the Fuel Depot in
//   the south-east: barrel tanks, a sandbag bund and a fuel truck.
// - Between them: the Tower just west of the middle, taxiway edge barriers
//   (north on the west half, south on the east half) and the open strip, a
//   40 m sniper lane along X.
// Balance is measured by scripts/validate.ts, not built in by symmetry.
import { ascii, type AsciiLegend, type MapDef } from "./types.ts";

const HX = 20;
const HZ = 14;

// W brick wall (hangar shells, forecourt), C container (terminal, tower,
// fuel truck), k crate (carts, tug), b concrete barrier, s sandbags, o barrels.
const LEGEND: AsciiLegend = {
  W: { kind: "wall", h: 1.2 },
  C: { kind: "container", h: 1.8 },
  k: { kind: "crate", h: 1.2 },
  b: { kind: "barrier", h: 1.2 },
  s: { kind: "sandbags", h: 1.1 },
  o: { kind: "barrels", h: 1.2 },
};

// Whole floor, 1 m per character: rows from z = -14 (top) to +14, columns
// from x = -20 (left) to +20.
const PLAN = [
  "......CCCCC............W......W......W..", //  0  z -14
  "......CCCCC............W......W......W..", //  1  z -13
  "k.....CCCCC............W..kk..W......W..", //  2  z -12
  "k..........b....CC.....W......W......W..", //  3  z -11
  "...........b....CC.....W......W......W..", //  4  z -10
  "........s..b...........WW....WWWW..WWW..", //  5  z -9
  "WWWW....s...............................", //  6  z -8
  "........s...............................", //  7  z -7
  "............bbbbbb......................", //  8  z -6
  "........................................", //  9  z -5
  "........................................", // 10  z -4
  "........kk..kk..........................", // 11  z -3
  "........................................", // 12  z -2
  "........................................", // 13  z -1
  "........................................", // 14  z +0
  ".........b..............................", // 15  z +1
  ".........b..............................", // 16  z +2
  ".........b..............................", // 17  z +3
  ".........b..............................", // 18  z +4
  ".........b.......bbbbb....bbbbbbbbb.....", // 19  z +5
  ".........b...........................CCC", // 20  z +6
  ".........b...........................CCC", // 21  z +7
  "sssss....b..................oo..oo......", // 22  z +8
  ".........b..................oo..oo......", // 23  z +9
  ".........................s..............", // 24  z +10
  ".........................s..............", // 25  z +11
  ".........................s....oo........", // 26  z +12
  ".........................s....oo........", // 27  z +13
];

export const RUNWAY: MapDef = {
  id: "runway",
  name: "Runway",
  blurb: "A long, bright airstrip: the terminal at one end, hangars and a fuel depot at the other, open tarmac between. Sniper's paradise.",
  halfX: HX,
  halfZ: HZ,
  obstacles: ascii(HX, HZ, PLAN, LEGEND),
  spawns: [
    { x: -17.5, z: -11.5 },
    { x: 18.5, z: 10 },
    { x: -17.5, z: 11 },
    { x: 15.5, z: -11.5 },
  ],
  decor: [
    // Flat clutter inside (never taller than an ankle, so it never reads as cover).
    { prop: "Debris_Papers_2", x: 3.6, z: -5.1, yaw: 3.4 },
    { prop: "WoodPlanks", x: 18.3, z: 4.4, yaw: 3.3 },
    { prop: "Pallet", x: -16, z: 12.7, yaw: 1.3 },
    { prop: "Debris_Papers_3", x: -16.6, z: -3, yaw: 0.2 },
    { prop: "Debris_Papers_1", x: -16.1, z: 4.4, yaw: 5.8 },
    { prop: "Debris_Papers_2", x: 10.8, z: 6.9, yaw: 0.4 },
    { prop: "WoodPlanks", x: 4.4, z: 2.2, yaw: 1.3 },
    { prop: "Pallet", x: 11.4, z: -5.4, yaw: 0.2 },
    { prop: "Debris_Papers_3", x: -4.4, z: -3.8, yaw: 5 },
    { prop: "Debris_Papers_1", x: -5.5, z: 5.6, yaw: 3.7 },
    { prop: "Debris_Papers_2", x: 0.2, z: -10.8, yaw: 4.8 },
    { prop: "WoodPlanks", x: -14.5, z: -9.6, yaw: 5.3 },
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
