// Free-for-all maps: 3-6 players, every player for themselves. They are bigger
// than the duel maps (52-60 m a side against 28-40), so each one carries a bit
// more data than a MapDef: named zones and landmarks (for callouts, the
// minimap and the preview), a player-count hint, and a lot more spawns.
//
// An FfaMapDef is a MapDef, so the simulation (physics, combat, sight) and the
// renderer (arenaView) take it as is. Nothing in the duel code knows about
// this module yet; see docs/ffa-maps.md for the wiring plan.
import type { Arena } from "../../arena.ts";
import { bodiesSee } from "../../sight.ts";
import type { MapDef, Spawn } from "../types.ts";
import { BASTION } from "./bastion.ts";
import { CROSSROADS } from "./crossroads.ts";
import { FREIGHT } from "./freight.ts";

/** A named rectangle of the floor with its own look. Zones tile most of the map; they may overlap. */
export interface FfaZone {
  id: string;
  name: string;
  /** Rectangle [x0, x1] x [z0, z1], world metres. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Tint for the minimap and the previews, 0xRRGGBB. Pick it close to the zone's dominant prop. */
  tint: number;
}

/** A point worth naming: what players call out, and what a minimap labels. */
export interface FfaLandmark {
  name: string;
  x: number;
  z: number;
}

export interface FfaMapDef extends MapDef {
  mode: "ffa";
  /** Players the layout is made for. The room should not start below `min` nor accept more than `max`. */
  players: { min: number; max: number };
  /** Zones, for callouts, the minimap and the previews. */
  zones: readonly FfaZone[];
  landmarks: readonly FfaLandmark[];
  /**
   * Where players drift to when they don't know where anyone is: the contested
   * centre. The validator's first-contact model walks everyone toward it.
   */
  hub: Spawn;
}

// `spawns` on an FfaMapDef are not mirrored pairs (the MapDef comment is about
// duel maps); there are 16 or more, spread all over, and any of them may be
// used for the first spawn or a respawn (ffaRespawnPoint below).

export const FFA_MAPS: readonly FfaMapDef[] = [CROSSROADS, FREIGHT, BASTION];

/** The FFA map with this id, or the first one for an unknown id. */
export function ffaMapById(id: string): FfaMapDef {
  return FFA_MAPS.find((m) => m.id === id) ?? FFA_MAPS[0];
}

/** Beyond this, a spawn counts as "far enough" from its nearest opponent; ties are broken at random. */
export const FFA_SPAWN_FAR = 22;
/** Closer than this to an opponent, a spawn is only used when nothing else is hidden. */
export const FFA_SPAWN_NEAR = 10;

/**
 * Respawn rule for N opponents, generalising sight.ts's `respawnPoint`:
 *
 * 1. spawns that no living opponent can see (`bodiesSee`) come first;
 * 2. then the ones whose nearest opponent is farther, capped at
 *    `FFA_SPAWN_FAR`: on a 56 m map "the farthest spawn" is always the same
 *    corner, which would park the player far from the action. Past 22 m every
 *    spawn is as good as another;
 * 3. ties (all the capped ones) are broken by `rand`, so respawns are not
 *    predictable. Pass a seeded function in tests.
 *
 * With no opponents, a random spawn. Every living opponent counts, including
 * one who is standing on a spawn (that spawn is then seen, and near 0 m).
 */
export function ffaRespawnPoint(
  arena: Arena,
  spawns: readonly Spawn[],
  opponents: readonly Spawn[],
  rand: () => number = Math.random,
): Spawn {
  if (!opponents.length) return spawns[Math.floor(rand() * spawns.length) % spawns.length];
  let best: Spawn[] = [];
  let bestKey = -Infinity;
  for (const s of spawns) {
    let hidden = true;
    let near = Infinity;
    for (const o of opponents) {
      near = Math.min(near, Math.hypot(s.x - o.x, s.z - o.z));
      if (hidden && bodiesSee(arena, s, o)) hidden = false;
    }
    // Hidden beats seen; then distance, capped. Quantised to 0.5 m so near-equal spawns tie.
    const key = (hidden && near >= FFA_SPAWN_NEAR ? 2000 : hidden ? 1000 : 0) + Math.round(Math.min(near, FFA_SPAWN_FAR) * 2);
    if (key > bestKey) {
      bestKey = key;
      best = [s];
    } else if (key === bestKey) best.push(s);
  }
  return best[Math.floor(rand() * best.length) % best.length];
}

/**
 * Match start: `n` distinct spawns, as spread out as the map allows. The
 * first is random; each next one is, among the spawns nobody placed so far can
 * see, one whose nearest placed player is farthest (uncapped, unlike
 * respawns), picked at random among those within 3 m of the best so starts
 * vary. Falls back to seen spawns only when every free one is seen.
 */
export function ffaStartSpawns(arena: Arena, spawns: readonly Spawn[], n: number, rand: () => number = Math.random): Spawn[] {
  const placed: Spawn[] = [spawns[Math.floor(rand() * spawns.length) % spawns.length]];
  while (placed.length < Math.min(n, spawns.length)) {
    const free = spawns.filter((s) => !placed.includes(s));
    const scored = free.map((s) => ({
      s,
      hidden: !placed.some((p) => bodiesSee(arena, s, p)),
      near: Math.min(...placed.map((p) => Math.hypot(s.x - p.x, s.z - p.z))),
    }));
    const pool = scored.some((c) => c.hidden) ? scored.filter((c) => c.hidden) : scored;
    const far = Math.max(...pool.map((c) => c.near));
    const top = pool.filter((c) => c.near >= far - 3);
    placed.push(top[Math.floor(rand() * top.length) % top.length].s);
  }
  return placed;
}
