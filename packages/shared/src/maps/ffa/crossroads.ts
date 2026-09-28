// Crossroads: a shelled town where two streets cross at a small square round
// a clock tower. Each quarter between the streets is its own place, and so is
// each street:
//
// - NW, the Walled Garden: a brick wall with four gates round a pinwheel of
//   hedges and a gazebo. Closed, middle-range fights.
// - SW, the Market: a dense grid of stalls with 2 m aisles. The shotgun and
//   SMG ground.
// - NE, the Building Site: a barrier fence, a half-built brick shell, the site
//   office and stacks of material. Mixed.
// - SE, the Car Park: a big open lot with a few parked cars, open to the East
//   Road. The rifle and sniper ground.
// - Streets: the North Road is a wide boulevard with jersey barriers down the
//   middle; the West Lane has a broken wall down the middle; the East Road is
//   open into the Car Park; the South Street is lined with the market's
//   overflow stalls.
// - The Square: the tower in a pinwheel of flower beds, so nobody sees the
//   middle from a street mouth.
//
// Nothing is mirrored. Balance is measured (bun scripts/ffa/validate.ts): the
// West team gets the Garden and the Market (closed), the East team the Site
// and the Car Park (open); the spawns are placed so both sides are as exposed,
// as close to cover and as far from the Square.
import { box, type Obstacle } from "../types.ts";
import type { FfaMapDef } from "./index.ts";

const H = 30;

// The Square and the clock tower.
const SQUARE: Obstacle[] = [
  box("container", 0, 0, 3, 3, 1.8), // Clock Tower
  // Flower beds round the tower, a pinwheel: nobody sees the tower from a
  // street mouth, you have to come in round a bed.
  box("sandbags", -1, -5.5, 5, 1, 1.1),
  box("sandbags", 5.5, 0, 1, 5, 1.1),
  box("sandbags", 1, 5.5, 5, 1, 1.1),
  box("sandbags", -6, -2, 1, 5, 1.1),
  // Kiosks on three corners. The south-west corner stays open: the smoke
  // test (smoke-teams.ts) shoots along z = 2.8 from x = -7 to 1.
  box("crate", -7.5, 7.5, 2, 2, 1.2),
  box("crate", 5, -5.5, 2, 2, 1.2),
  box("crate", 9, 3.5, 2, 2, 1.2),
];

// NW: the Walled Garden (x -26..-7, z -26..-4), a gate on each side and one
// at the corner on the Square; inside, a pinwheel of hedges round the gazebo.
const GARDEN: Obstacle[] = [
  box("wall", -20.5, -25.5, 11, 1, 1.2),
  box("wall", -9.5, -25.5, 5, 1, 1.2),
  box("wall", -25.5, -21, 1, 8, 1.2),
  box("wall", -25.5, -9.5, 1, 9, 1.2),
  box("wall", -7.5, -20, 1, 10, 1.2),
  box("wall", -7.5, -10, 1, 6, 1.2),
  box("wall", -22, -4.5, 8, 1, 1.2),
  box("wall", -12, -4.5, 6, 1, 1.2),
  box("sandbags", -20.5, -20.5, 5, 1, 1.1),
  box("sandbags", -12, -20.5, 1, 5, 1.1),
  box("sandbags", -12.5, -11, 5, 1, 1.1),
  box("sandbags", -21, -11.5, 1, 5, 1.1),
  box("crate", -16.5, -16, 2, 2, 1.2),
];

// SW: the Market (x -28..-6, z 8..28): rows of stalls, offset so the aisles
// jog. The tightest ground on the map, for the shotgun and SMG.
const MARKET: Obstacle[] = [
  box("crate", -24, 9, 3, 2, 1.2),
  box("crate", -18.5, 9, 3, 2, 1.2),
  box("crate", -12.5, 9.5, 3, 2, 1.2),
  box("crate", -26.5, 13.5, 3, 2, 1.2),
  box("crate", -21.5, 13.5, 3, 2, 1.2),
  box("crate", -16, 14, 3, 2, 1.2),
  box("crate", -9.5, 14, 2, 3, 1.2),
  box("crate", -24, 18.5, 3, 2, 1.2),
  box("crate", -18.5, 18, 3, 2, 1.2),
  box("barrels", -13, 18.5, 2, 2, 1.2),
  box("crate", -26.5, 23, 3, 2, 1.2),
  box("crate", -21, 22.5, 3, 2, 1.2),
  box("crate", -15.5, 23, 3, 2, 1.2),
  box("crate", -9, 21.5, 2, 3, 1.2),
  box("crate", -19, 27, 4, 2, 1.2),
  box("barrier", -6.5, 9, 3, 1, 1.2),
];

// NE: the Building Site (x 7..29, z -27..-7): a barrier fence closed at the
// Square corner, a half-built brick shell, the site office (the one tall block
// off the Square) and the material stacks.
const SITE: Obstacle[] = [
  box("barrier", 7.5, -21.5, 1, 9, 1.2),
  box("barrier", 7.5, -10.5, 1, 5, 1.2),
  box("barrier", 15, -7.5, 14, 1, 1.2),
  box("wall", 13, -21, 1, 6, 1.2),
  box("wall", 16.5, -17.5, 8, 1, 1.2),
  box("wall", 20, -23, 1, 4, 1.2),
  box("container", 24, -24, 3, 2, 1.8),
  box("crate", 24.5, -16, 2, 3, 1.2),
  box("barrels", 17, -12.5, 1.5, 1.5, 1.2),
  box("crate", 11.5, -11.5, 2, 2, 1.2),
  box("sandbags", 26.5, -9.5, 3, 1, 1.1),
];

// SE: the Car Park (x 8..29, z 3..29): a big open lot with a few parked cars
// and a kerb along the South Street, the long rifle and sniper lines.
const CARPARK: Obstacle[] = [
  box("crate", 11, 12, 2, 4, 1.2),
  box("crate", 19, 14, 2, 4, 1.2),
  box("crate", 25, 3.5, 2, 2, 1.2),
  box("crate", 25, 9, 4, 2, 1.2),
  box("crate", 13, 21, 2, 4, 1.2),
  box("crate", 27, 19, 2, 4, 1.2),
  box("crate", 12, 26, 4, 2, 1.2),
  box("crate", 20, 26, 4, 2, 1.2),
  box("barrier", 5.5, 16, 1, 6, 1.2),
];

// The four streets, each dressed its own way.
const STREETS: Obstacle[] = [
  // North Road, a boulevard: jersey barriers down the middle, one gap.
  box("barrier", 0, -13.5, 1, 8, 1.2),
  box("barrier", 0, -23.5, 1, 8, 1.2),
  // West Lane: a broken wall and a barrier down the middle.
  box("wall", -15, 0.5, 8, 1, 1.2),
  box("barrier", -24.5, 0.5, 6, 1, 1.2),
  // East Road: open into the Car Park, one car on the kerb.
  box("crate", 15, -3, 4, 2, 1.2),
  // South Street: the market's overflow, stalls down the middle.
  box("crate", 0, 13, 2, 4, 1.2),
  box("barrels", 0, 18.5, 2, 3, 1.2),
  box("crate", 0, 24, 2, 4, 1.2),
  // Corner cover: a potting shed, a skip, a stall, a broken-down van.
  box("crate", -27, -21, 2, 2, 1.2),
  box("barrels", 27.5, -21, 1.5, 1.5, 1.2),
  box("crate", -26.5, 27, 3, 2, 1.2),
  box("crate", 27, 24.5, 2, 3, 1.2),
];

const OBSTACLES: Obstacle[] = [...SQUARE, ...GARDEN, ...MARKET, ...SITE, ...CARPARK, ...STREETS];

const SPAWNS = [
  // West (x < 0): 0-3 by the Garden, 4-7 by the Market.
  { x: -13, z: -9.5 },
  { x: -17, z: -24 },
  { x: -28, z: -12 },
  { x: -9, z: -20 },
  { x: -7, z: 16 },
  { x: -27, z: 8 },
  { x: -28, z: 20 },
  { x: -12, z: 24 },
  // East (x > 0): 8-11 by the Site, 12-15 by the Car Park.
  { x: 15, z: -5.5 },
  { x: 11, z: -20 },
  { x: 20, z: -26 },
  { x: 26, z: -11 },
  { x: 9, z: 13 },
  { x: 19, z: 17.5 },
  { x: 20, z: 28 },
  { x: 29, z: 21.5 },
];

export const CROSSROADS: FfaMapDef = {
  id: "crossroads",
  name: "Crossroads",
  blurb: "A shelled town where two streets cross at the clock tower: a walled garden, a market, a building site and a car park.",
  mode: "ffa",
  players: { min: 3, max: 6 },
  halfX: H,
  halfZ: H,
  obstacles: OBSTACLES,
  spawns: SPAWNS,
  hub: { x: 0, z: 0 },
  // Team deathmatch: the west half (Garden and Market) against the east half
  // (Building Site and Car Park).
  teams: [
    { name: "West", spawns: [0, 1, 2, 3, 4, 5, 6, 7] },
    { name: "East", spawns: [8, 9, 10, 11, 12, 13, 14, 15] },
  ],
  zones: [
    { id: "square", name: "Square", x0: -9, z0: -9, x1: 9, z1: 9, tint: 0xd8c9a8 },
    { id: "garden", name: "Walled Garden", x0: -30, z0: -30, x1: -7, z1: -4, tint: 0x6f8f4e },
    { id: "site", name: "Building Site", x0: 7, z0: -30, x1: 30, z1: -7, tint: 0xa7a9a3 },
    { id: "carpark", name: "Car Park", x0: 6, z0: 6, x1: 30, z1: 30, tint: 0x6b6f78 },
    { id: "market", name: "Market", x0: -30, z0: 8, x1: -5, z1: 30, tint: 0xb9823f },
    { id: "north", name: "North Road", x0: -7, z0: -30, x1: 7, z1: -9, tint: 0x8c8c8c },
    { id: "east", name: "East Road", x0: 9, z0: -7, x1: 30, z1: 6, tint: 0x8c8c8c },
    { id: "south", name: "South Street", x0: -5, z0: 9, x1: 5, z1: 30, tint: 0x9c8466 },
    { id: "west", name: "West Lane", x0: -30, z0: -4, x1: -9, z1: 8, tint: 0x7d6f5c },
  ],
  landmarks: [
    { name: "Clock Tower", x: 0, z: 0 },
    { name: "Gazebo", x: -16.5, z: -16 },
    { name: "Site Office", x: 24, z: -24 },
    { name: "Car Park", x: 20, z: 20 },
    { name: "Market", x: -20, z: 18 },
  ],
  decor: [],
  theme: {
    floor: 0x8a7d6a,
    grid: 0x9c8f7a,
    gridOpacity: 0.18,
    outerFloor: 0x5d5446,
    background: 0x2a2620,
    wall: "brick",
    hemiSky: 0xfff1d6,
    hemiGround: 0x4a4034,
    hemiIntensity: 1.1,
    sun: 0xffe0b0,
    sunIntensity: 2.2,
    sunDir: { x: 14, y: 26, z: 8 },
  },
  favours: ["rifle", "sniper", "shotgun"],
};
