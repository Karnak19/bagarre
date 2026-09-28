// Pure, deterministic simulation steps. The server runs these to produce the
// authoritative state; the client runs the exact same functions to predict its
// own player. No randomness, no wall-clock time, no side effects.
// (Player abilities and weapons build on these in combat.ts.)

import type { Arena, Box } from "./arena.ts";
import {
  BULLET_RADIUS,
  BULLET_MAX_SUBSTEP,
  BULLET_SUBSTEPS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_DT,
} from "./constants.ts";

export interface Vec2 {
  x: number;
  z: number;
}

export interface MoveInput {
  /** World-space move direction on X. */
  mx: number;
  /** World-space move direction on Z. */
  mz: number;
}

export interface BulletSim {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Sanitises a move vector: non-finite values become 0, length is clamped to 1. */
export function clampMove(mx: number, mz: number): Vec2 {
  const x = Number.isFinite(mx) ? mx : 0;
  const z = Number.isFinite(mz) ? mz : 0;
  const len2 = x * x + z * z;
  if (len2 > 1) {
    const len = Math.sqrt(len2);
    return { x: x / len, z: z / len };
  }
  return { x, z };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Pushes a circle out of an axis-aligned box, if they overlap. */
function resolveCircleBox(p: Vec2, r: number, b: Box): Vec2 {
  const minX = b.x - b.w / 2;
  const maxX = b.x + b.w / 2;
  const minZ = b.z - b.d / 2;
  const maxZ = b.z + b.d / 2;
  const cx = clamp(p.x, minX, maxX);
  const cz = clamp(p.z, minZ, maxZ);
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return p;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    return { x: cx + (dx / d) * r, z: cz + (dz / d) * r };
  }
  // Centre is inside the box: push out along the axis of least penetration.
  const left = p.x - minX;
  const right = maxX - p.x;
  const top = p.z - minZ;
  const bottom = maxZ - p.z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: minX - r, z: p.z };
  if (m === right) return { x: maxX + r, z: p.z };
  if (m === top) return { x: p.x, z: minZ - r };
  return { x: p.x, z: maxZ + r };
}

export function circleOverlapsBox(x: number, z: number, r: number, b: Box): boolean {
  const cx = clamp(x, b.x - b.w / 2, b.x + b.w / 2);
  const cz = clamp(z, b.z - b.d / 2, b.z + b.d / 2);
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function circlesOverlap(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  const r = ar + br;
  return dx * dx + dz * dz < r * r;
}

/** Longest distance moved between two collision passes. */
const MOVE_SUBSTEP = 0.25;

/**
 * Moves a player circle by (dx, dz) with collision against the arena's cover
 * and walls. Long moves (a dash covers ~1 m per tick, as thick as the thinnest
 * wall) are split into sub-steps so they can't tunnel through cover. A normal
 * walking step is shorter than one sub-step, so it takes exactly one pass.
 */
export function movePlayer(arena: Arena, pos: Vec2, dx: number, dz: number): Vec2 {
  const len = Math.sqrt(dx * dx + dz * dz);
  const n = Math.max(1, Math.ceil(len / MOVE_SUBSTEP));
  const sx = dx / n;
  const sz = dz / n;
  const limX = arena.halfX - PLAYER_RADIUS;
  const limZ = arena.halfZ - PLAYER_RADIUS;
  let p: Vec2 = pos;
  for (let i = 0; i < n; i++) {
    p = { x: p.x + sx, z: p.z + sz };
    // Two passes settle the case of being wedged between two boxes.
    for (let pass = 0; pass < 2; pass++) {
      for (const b of arena.obstacles) p = resolveCircleBox(p, PLAYER_RADIUS, b);
    }
    p = { x: clamp(p.x, -limX, limX), z: clamp(p.z, -limZ, limZ) };
  }
  return p;
}

/** Plain walking for one tick (no abilities). */
export function walk(arena: Arena, pos: Vec2, input: MoveInput, dt: number = TICK_DT): Vec2 {
  const m = clampMove(input.mx, input.mz);
  return movePlayer(arena, pos, m.x * PLAYER_SPEED * dt, m.z * PLAYER_SPEED * dt);
}

export function bulletBlocked(arena: Arena, x: number, z: number): boolean {
  const limX = arena.halfX - BULLET_RADIUS;
  const limZ = arena.halfZ - BULLET_RADIUS;
  if (x < -limX || x > limX || z < -limZ || z > limZ) return true;
  for (const b of arena.obstacles) {
    if (circleOverlapsBox(x, z, BULLET_RADIUS, b)) return true;
  }
  return false;
}

/**
 * Advances a bullet by one tick in sub-steps. `onSubstep` is called after each
 * sub-step with the bullet's position; return true from it to stop the bullet
 * (the server uses it for player hits). Returns false once the bullet is dead.
 */
export function stepBullet(
  arena: Arena,
  b: BulletSim,
  onSubstep?: (x: number, z: number) => boolean,
  dt: number = TICK_DT,
): boolean {
  const steps = Math.max(BULLET_SUBSTEPS, Math.ceil((Math.hypot(b.vx, b.vz) * dt) / BULLET_MAX_SUBSTEP));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    b.x += b.vx * sdt;
    b.z += b.vz * sdt;
    if (bulletBlocked(arena, b.x, b.z)) return false;
    if (onSubstep && onSubstep(b.x, b.z)) return false;
  }
  return true;
}

// --- Segments (line of sight) ------------------------------------------------

const SEG_EPS = 1e-6;

/**
 * True if the segment a-c passes through the open interior of box `b`
 * inflated by `r` (a slab test). Grazing an edge or a corner doesn't count.
 */
export function segmentHitsBox(a: Vec2, c: Vec2, b: Box, r: number): boolean {
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
      if (p <= lo + SEG_EPS || p >= hi - SEG_EPS) return false;
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

/**
 * Line of sight on the ground: no cover box crosses the segment a-b. Every
 * box counts, low sandbags included (they stop bullets, so they stop a look).
 * Both points are inside the arena, so the outer walls never matter.
 */
export function lineOfSight(arena: Arena, a: Vec2, b: Vec2): boolean {
  for (const o of arena.obstacles) if (segmentHitsBox(a, b, o, 0)) return false;
  return true;
}

/** True if the segment a-b comes closer than `r` to the point `c` (it crosses the circle, or starts or ends in it). */
export function segmentHitsCircle(a: Vec2, b: Vec2, c: Vec2, r: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 1e-12 ? clamp(((c.x - a.x) * dx + (c.z - a.z) * dz) / len2, 0, 1) : 0;
  const px = a.x + dx * t - c.x;
  const pz = a.z + dz * t - c.z;
  return px * px + pz * pz < r * r;
}

/** Where a bullet appears when a player at (x, z) fires at `aim` radians. */
export function muzzle(x: number, z: number, aim: number): Vec2 {
  const off = PLAYER_RADIUS + BULLET_RADIUS + 0.05;
  return { x: x + Math.cos(aim) * off, z: z + Math.sin(aim) * off };
}
