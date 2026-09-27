// The team deathmatch check of an FFA map's red and blue sides (`teams` on an
// FfaMapDef), run by ffa/validate.ts next to the FFA checks. A side is a list
// of indices into the map's spawns; the check is about the split, not the
// spawns themselves (the FFA checks cover those).

import { TEAM_SIZE } from "../../src/constants.ts";
import type { FfaMapDef } from "../../src/maps/ffa/index.ts";
import { bodiesSee } from "../../src/sight.ts";

/** Spawns each side needs: a full team, plus room to respawn away from a camper. */
export const MIN_TEAM_SPAWNS = TEAM_SIZE + 2;
/** The two sides' mean distance to the hub may differ by at most this (metres): neither is closer to the action. */
export const MAX_HUB_GAP = 1;
/** The same for each side's closest spawn to the hub. */
export const MAX_NEAREST_GAP = 1;
/** A spawn this close to an enemy spawn would let a team camp the other's respawns. */
export const MIN_ENEMY_SPAWN_DIST = 10;

export interface TeamSideStats {
  /** Spawns on each side. */
  counts: [number, number];
  /** Mean and closest distance to the hub, per side. */
  hubMean: [number, number];
  hubNearest: [number, number];
  /** The closest pair of spawns on opposite sides, metres. */
  enemyGap: number;
  /** Pairs of opposite spawns in each other's sight (report). */
  pairsInSight: number;
}

export function checkTeams(m: FfaMapDef): { errors: string[]; stats: TeamSideStats | null } {
  const errors: string[] = [];
  const sides = m.teams;
  if (!sides) return { errors, stats: null };
  const seen = new Set<number>();
  for (const [t, side] of sides.entries()) {
    for (const i of side.spawns) {
      if (!Number.isInteger(i) || i < 0 || i >= m.spawns.length) errors.push(`team ${t} (${side.name}): spawn index ${i} is not a spawn`);
      else if (seen.has(i)) errors.push(`team ${t} (${side.name}): spawn ${i} is on both sides, or twice`);
      seen.add(i);
    }
    if (side.spawns.length < MIN_TEAM_SPAWNS) errors.push(`team ${t} (${side.name}) has ${side.spawns.length} spawns, needs >= ${MIN_TEAM_SPAWNS}`);
  }
  if (errors.length) return { errors, stats: null };

  const pts = sides.map((side) => side.spawns.map((i) => m.spawns[i]));
  const hub = (p: { x: number; z: number }) => Math.hypot(p.x - m.hub.x, p.z - m.hub.z);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const hubMean = pts.map((ps) => mean(ps.map(hub))) as [number, number];
  const hubNearest = pts.map((ps) => Math.min(...ps.map(hub))) as [number, number];
  let enemyGap = Infinity;
  let pairsInSight = 0;
  for (const a of pts[0])
    for (const b of pts[1]) {
      enemyGap = Math.min(enemyGap, Math.hypot(a.x - b.x, a.z - b.z));
      if (bodiesSee(m, a, b)) pairsInSight++;
    }
  if (Math.abs(hubMean[0] - hubMean[1]) > MAX_HUB_GAP)
    errors.push(`sides unbalanced: mean distance to the hub ${hubMean[0].toFixed(1)} m vs ${hubMean[1].toFixed(1)} m (max gap ${MAX_HUB_GAP} m)`);
  if (Math.abs(hubNearest[0] - hubNearest[1]) > MAX_NEAREST_GAP)
    errors.push(`sides unbalanced: closest spawn to the hub ${hubNearest[0].toFixed(1)} m vs ${hubNearest[1].toFixed(1)} m (max gap ${MAX_NEAREST_GAP} m)`);
  if (enemyGap < MIN_ENEMY_SPAWN_DIST) errors.push(`a spawn is ${enemyGap.toFixed(1)} m from an enemy spawn (min ${MIN_ENEMY_SPAWN_DIST} m)`);
  return {
    errors,
    stats: { counts: [pts[0].length, pts[1].length], hubMean, hubNearest, enemyGap, pairsInSight },
  };
}
