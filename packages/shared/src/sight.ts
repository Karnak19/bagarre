// Line of sight on the ground plane. Used by the server to pick a respawn the
// opponent can't see, and by the map validator (scripts/analyze.ts) for its
// spawn and sightline checks. Every box blocks bullets, so "can see" and "can
// shoot" are the same thing here.

import type { Arena, Box } from "./arena.ts";
import { BULLET_RADIUS, PLAYER_RADIUS } from "./constants.ts";
import type { Vec2 } from "./physics.ts";

const EPS = 1e-6;

/** True if segment a-c passes through the open interior of `b` inflated by `r`. */
export function segHitsBox(a: Vec2, c: Vec2, b: Box, r: number): boolean {
  const minX = b.x - b.w / 2 - r;
  const maxX = b.x + b.w / 2 + r;
  const minZ = b.z - b.d / 2 - r;
  const maxZ = b.z + b.d / 2 + r;
  let t0 = 0;
  let t1 = 1;
  const dx = c.x - a.x;
  const dz = c.z - a.z;
  const axes: [number, number, number, number][] = [
    [a.x, dx, minX, maxX],
    [a.z, dz, minZ, maxZ],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (p <= lo + EPS || p >= hi - EPS) return false;
      continue;
    }
    let u0 = (lo - p) / d;
    let u1 = (hi - p) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t1 - t0 <= 1e-9) return false;
  }
  return t1 - t0 > 1e-9;
}

/** Bullet line of sight between two centres. */
export function clearShot(arena: Arena, a: Vec2, b: Vec2): boolean {
  for (const o of arena.obstacles) if (segHitsBox(a, b, o, BULLET_RADIUS)) return false;
  return true;
}

/**
 * Can either body see (and shoot) any part of the other? Checks the centre
 * line and two parallel lines along the edges of the bodies. Stricter than a
 * single ray: two points pass only if both bodies are fully hidden.
 */
export function bodiesSee(arena: Arena, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * PLAYER_RADIUS * 0.9;
  const nz = (dx / L) * PLAYER_RADIUS * 0.9;
  for (const s of [0, 1, -1]) {
    if (clearShot(arena, { x: a.x + nx * s, z: a.z + nz * s }, { x: b.x + nx * s, z: b.z + nz * s })) return true;
  }
  return false;
}

/**
 * Where a player respawns: among `spawns`, the ones the opponent can't see
 * come first, then the farthest from the opponent. With no opponent, the
 * player's own slot spawn (`fallback`).
 */
export function respawnPoint(arena: Arena, spawns: readonly Vec2[], opponent: Vec2 | null, fallback: Vec2): Vec2 {
  if (!opponent) return fallback;
  let best = fallback;
  let bestHidden = false;
  let bestD = -1;
  for (const s of spawns) {
    const hidden = !bodiesSee(arena, s, opponent);
    const d = (s.x - opponent.x) ** 2 + (s.z - opponent.z) ** 2;
    if ((hidden && !bestHidden) || (hidden === bestHidden && d > bestD)) {
      best = s;
      bestHidden = hidden;
      bestD = d;
    }
  }
  return best;
}
