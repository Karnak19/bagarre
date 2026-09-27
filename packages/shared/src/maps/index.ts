// Every duel map. Each duel match picks one at random (GameRoom.pickMap);
// the free-for-all maps are FFA_MAPS (ffa/), never in MAPS.
// `MAPS[0]` is the original arena, kept as the default.
import { DOCKSIDE } from "./dockside.ts";
import { FFA_MAPS } from "./ffa/index.ts";
import { FORT } from "./fort.ts";
import { NEST } from "./nest.ts";
import { RUNWAY } from "./runway.ts";
import { SCRAPYARD } from "./scrapyard.ts";
import { TRENCHWORKS } from "./trenchworks.ts";
import type { MapDef } from "./types.ts";
import { YARD } from "./yard.ts";

export * from "./types.ts";
export * from "./ffa/index.ts";

export const MAPS: readonly MapDef[] = [YARD, RUNWAY, TRENCHWORKS, FORT, DOCKSIDE, NEST, SCRAPYARD];

export const DEFAULT_MAP_ID = YARD.id;

/**
 * The map with this id, duel or FFA, or null. The one lookup for a synced
 * `mapId`: an FFA room's map must never read as a duel map.
 */
export function findMap(id: string): MapDef | null {
  return MAPS.find((m) => m.id === id) ?? FFA_MAPS.find((m) => m.id === id) ?? null;
}

/**
 * The map with this id (duel or FFA), or Yard for an unknown id. Only for
 * display and tests: rooms pick from their own pool, and the client resolves
 * `state.mapId` with `findMap` (an unknown id is an error there, not Yard).
 */
export function mapById(id: string): MapDef {
  return findMap(id) ?? YARD;
}
