// The team deathmatch check of an FFA map's red and blue sides (`teams` on an
// FfaMapDef), run by ffa/validate.ts next to the FFA checks. A side is a list
// of indices into the map's spawns; the check is about the split, not the
// spawns themselves (the FFA checks cover those). The maps are not mirrored,
// so the two sides are compared metric by metric (BALANCE below).

import { TEAM_SIZE } from "../../src/constants.ts";
import type { FfaMapDef } from "../../src/maps/ffa/index.ts";
import { bodiesSee } from "../../src/sight.ts";
import { allowedGap, cellPt, coverFacing, walkField, type Tolerance } from "../analyze.ts";
import type { FfaReport } from "./analyze.ts";

/** Spawns each side needs: a full team, plus room to respawn away from a camper. */
export const MIN_TEAM_SPAWNS = TEAM_SIZE + 2;
/** The two sides' mean distance to the hub may differ by at most this (metres): neither is closer to the action. */
export const MAX_HUB_GAP = 1;
/** The same for each side's closest spawn to the hub. */
export const MAX_NEAREST_GAP = 1;
/** A spawn this close to an enemy spawn would let a team camp the other's respawns. */
export const MIN_ENEMY_SPAWN_DIST = 10;

/**
 * Side balance: each metric computed for both sides, gap within
 * max(abs, rel x the larger value). Means are over the side's spawns (the
 * per-spawn values of the FFA check); the territory metrics split the floor by
 * walking distance to the nearest spawn of each side.
 */
export const BALANCE: Record<
  "exposure" | "cover" | "hubWalk" | "camNear" | "territory" | "camHidden" | "tallShadow" | "camCover",
  { label: string; unit: "%" | "m"; tol: Tolerance }
> = {
  exposure: { label: "mean spawn exposure", unit: "%", tol: { abs: 0.015, rel: 0.15 } },
  cover: { label: "mean nearest cover", unit: "m", tol: { abs: 0.5, rel: 0 } },
  hubWalk: { label: "mean walk to the hub", unit: "m", tol: { abs: 1.5, rel: 0.05 } },
  camNear: { label: "mean cam-hidden near spawn", unit: "%", tol: { abs: 0.015, rel: 0 } },
  territory: { label: "territory (walk split)", unit: "%", tol: { abs: 0.06, rel: 0 } },
  camHidden: { label: "cam-hidden territory", unit: "%", tol: { abs: 0.015, rel: 0 } },
  tallShadow: { label: "tall-box shadow in territory", unit: "%", tol: { abs: 0.02, rel: 0 } },
  camCover: { label: "cam-hidden cover spots (vs hub)", unit: "%", tol: { abs: 0.08, rel: 0 } },
};
export type BalanceKey = keyof typeof BALANCE;
export const BALANCE_KEYS = Object.keys(BALANCE) as BalanceKey[];

export interface TeamSideStats {
  /** Spawns on each side. */
  counts: [number, number];
  /** Mean and closest distance to the hub, per side. */
  hubMean: [number, number];
  hubNearest: [number, number];
  /** The closest pair of spawns on opposite sides, metres. */
  enemyGap: number;
  /** Pairs of opposite spawns in each other's sight, at any distance (must be 0). */
  pairsInSight: number;
  /** Side-by-side balance metrics: both values, gap, allowed gap. */
  balance: { key: BalanceKey; a: number; b: number; gap: number; tol: number }[];
}

export function checkTeams(m: FfaMapDef, r: FfaReport): { errors: string[]; stats: TeamSideStats | null } {
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
  // The server picks each team's starts on its own side without looking at the
  // other team, so any opposite pair in sight could start a match with enemies
  // face to face. Sight, not range: a sniper or the next few steps close any gap.
  for (const [i, a] of pts[0].entries())
    for (const [j, b] of pts[1].entries())
      if (bodiesSee(m, a, b))
        errors.push(
          `spawn ${sides[0].spawns[i]} (${a.x},${a.z}) and enemy spawn ${sides[1].spawns[j]} (${b.x},${b.z}) see each other, ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)} m (no opposite pair may)`,
        );

  // Balance, side by side.
  const g = r.grid;
  const fields = pts.map((ps) => walkField(g, ps));
  const terr = [0, 0];
  const hid = [0, 0];
  const tall = [0, 0];
  const spots = [0, 0];
  const spotsHid = [0, 0];
  let reach = 0;
  for (let c = 0; c < g.walk.length; c++) {
    const a = fields[0][c];
    const b = fields[1][c];
    if (a === Infinity && b === Infinity) continue;
    reach++;
    const hugs = coverFacing(m, cellPt(g, c), m.hub);
    for (const [t, w] of [[0, a < b ? 1 : a === b ? 0.5 : 0], [1, b < a ? 1 : a === b ? 0.5 : 0]] as const) {
      if (!w) continue;
      terr[t] += w;
      hid[t] += w * r.cam.chest[c];
      tall[t] += w * r.cam.tall[c];
      if (hugs) {
        spots[t] += w;
        spotsHid[t] += w * r.cam.chest[c];
      }
    }
  }
  const sideMean = (key: "exposure" | "cover" | "hubWalk" | "camNear") => sides.map((sd) => mean(sd.spawns.map((i) => r.spawns[i][key])));
  const vals: Record<BalanceKey, number[]> = {
    exposure: sideMean("exposure"),
    cover: sideMean("cover"),
    hubWalk: sideMean("hubWalk"),
    camNear: sideMean("camNear"),
    territory: terr.map((t) => (reach ? t / reach : 0)),
    camHidden: [0, 1].map((t) => (terr[t] ? hid[t] / terr[t] : 0)),
    tallShadow: [0, 1].map((t) => (terr[t] ? tall[t] / terr[t] : 0)),
    camCover: [0, 1].map((t) => (spots[t] ? spotsHid[t] / spots[t] : 0)),
  };
  const balance = BALANCE_KEYS.map((key) => {
    const [a, b] = vals[key];
    return { key, a, b, gap: Math.abs(a - b), tol: allowedGap(BALANCE[key].tol, a, b) };
  });
  const u = (unit: "%" | "m", v: number) => (unit === "%" ? `${(v * 100).toFixed(1)} %` : `${v.toFixed(1)} m`);
  for (const x of balance)
    if (x.gap > x.tol) {
      const d = BALANCE[x.key];
      errors.push(`sides unbalanced: ${d.label} ${u(d.unit, x.a)} vs ${u(d.unit, x.b)}, gap ${u(d.unit, x.gap)} > ${u(d.unit, x.tol)}`);
    }
  return {
    errors,
    stats: { counts: [pts[0].length, pts[1].length], hubMean, hubNearest, enemyGap, pairsInSight, balance },
  };
}
