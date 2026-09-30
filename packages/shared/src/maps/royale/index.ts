// Battle royale maps: up to 10 players, one life, crates to loot, and a zone
// that closes on a final circle. They are bigger than the FFA maps (80-100 m
// a side) and carry what the mode needs on top of a MapDef: start spots
// (no respawns, so `spawns` are fair starts, not pairs), crate spots and the
// rectangle where the final zone's centre may land.
//
// A RoyaleMapDef is a MapDef, so the simulation and the renderer take it as
// is. It is not in MAPS nor in FFA_MAPS: only the royale mode's pool uses it.
// `findMap` finds it, so a synced `mapId` resolves. See docs/royale-maps.md;
// scripts/royale.check.ts checks every map here.
import type { MapDef, Spawn } from "../types.ts";
import type { FfaLandmark, FfaZone } from "../ffa/index.ts";
import { IRONVALE } from "./ironvale.ts";

export interface RoyaleMapDef extends MapDef {
  mode: "royale";
  /** Players the layout is made for. */
  players: { min: number; max: number };
  /** Named districts, for callouts, a minimap and the previews (same shape as the FFA zones). */
  zones: readonly FfaZone[];
  landmarks: readonly FfaLandmark[];
  /** The contested centre, where the early crate cluster is. */
  hub: Spawn;
  /**
   * Start spots (the MapDef `spawns` doc about pairs is for duels): at least
   * 12, spread round the map, no two in sight of each other at any distance.
   * Nobody respawns in this mode, so these are only about fair starts.
   */
  // spawns: readonly Spawn[] (inherited)
  /**
   * Crate spots, 15-25: a few in the centre, some in the open, some in
   * buildings and corners.
   * Placeholder name: rename to whatever #32 (the royale mode) lands with.
   */
  crates: readonly Spawn[];
  /**
   * Where the final zone's centre may land: a rectangle, world metres, kept
   * off the edges. Placeholder name: rename to whatever #32 lands with.
   */
  finalZone: { x0: number; z0: number; x1: number; z1: number };
}

export const ROYALE_MAPS: readonly RoyaleMapDef[] = [IRONVALE];

/** The royale map with this id, or the first one for an unknown id. */
export function royaleMapById(id: string): RoyaleMapDef {
  return ROYALE_MAPS.find((m) => m.id === id) ?? ROYALE_MAPS[0];
}
