// Every playable map. Each match picks one at random (DuelRoom.pickMap);
// `MAPS[0]` is the original arena, kept as the default.
import { DOCKSIDE } from "./dockside.ts";
import { FORT } from "./fort.ts";
import { NEST } from "./nest.ts";
import { RUNWAY } from "./runway.ts";
import { SCRAPYARD } from "./scrapyard.ts";
import { TRENCHWORKS } from "./trenchworks.ts";
import type { MapDef } from "./types.ts";
import { YARD } from "./yard.ts";

export * from "./types.ts";

export const MAPS: readonly MapDef[] = [YARD, RUNWAY, TRENCHWORKS, FORT, DOCKSIDE, NEST, SCRAPYARD];

export const DEFAULT_MAP_ID = YARD.id;

/** The map with this id, or the default one for an unknown id. */
export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? YARD;
}
