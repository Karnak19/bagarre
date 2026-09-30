// Battle royale maps: up to 10 players, one life, crates to loot, and a zone
// that closes on a final circle. They are bigger than the FFA maps (80-100 m
// a side) and carry what the mode needs on top of a MapDef: start spots
// (no respawns, so `spawns` are fair starts, not pairs), named districts for
// callouts and the maps page, and `royale` (crate spots and the rectangle the
// zone's final centre is drawn in, RoyaleMapData in ../types.ts), which is
// required here.
//
// A RoyaleMapDef is a MapDef, so the simulation and the renderer take it as
// is. ROYALE_MAPS is the royale mode's pool (ROYALE_RULES.maps) and nothing
// else: these maps are never in MAPS (duels), FFA_MAPS or TEAM_MAPS, and
// `ffaMapById` never falls back to one. `findMap` finds them, so a synced
// `mapId` resolves. See docs/royale-maps.md; scripts/royale-maps.check.ts
// checks the layout of every map here, scripts/royale.check.ts its crate spots
// and zone against the mode's rules.
import type { MapDef, RoyaleMapData, Spawn } from "../types.ts";
import type { FfaLandmark, FfaZone } from "../ffa/index.ts";
import { IRONVALE } from "./ironvale.ts";

export interface RoyaleMapDef extends MapDef {
  mode: "royale";
  /** Players the layout is made for. */
  players: { min: number; max: number };
  /** Named districts, for callouts, a minimap and the previews (same shape as the FFA zones). */
  zones: readonly FfaZone[];
  landmarks: readonly FfaLandmark[];
  /** The contested centre, where the early crate cluster is; starts aim toward it. */
  hub: Spawn;
  /**
   * Start spots (the MapDef `spawns` doc about pairs is for duels): at least
   * 10 (one per player, MIN_STARTS in scripts/royale-maps.check.ts), spread
   * round the map, no two in sight of each other at any distance. Nobody
   * respawns in this mode, so these are only about fair starts.
   */
  // spawns: readonly Spawn[] (inherited)
  /** Crate spots (15-25 here) and the final zone's limits. Required on a royale map. */
  royale: RoyaleMapData;
}

/**
 * The battle royale pool: Ironvale alone, so every royale match plays on it
 * (one royale map, no random pick: see issue #33's scope).
 */
export const ROYALE_MAPS: readonly RoyaleMapDef[] = [IRONVALE];
