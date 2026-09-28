// The four grenade types (GRENADES in constants.ts): what each one does when
// it goes off. They share the throw (grenadeTarget / grenadeArc /
// grenadeFlightTicks in combat.ts) and differ only in their blast:
//
// - frag: damage with falloff (grenadeDamage, combat.ts). The only one that
//   hurts or kills, and the only one the kill feed calls "Grenade".
// - smoke: a cloud on the ground for SMOKE.duration. Who is in it, or behind
//   it, is hidden from their enemies (smokeHides / smokeVeil below).
// - stun: `stunTicks` on everyone in the radius; `stepPlayer` slows them and
//   blocks their dash while it runs.
// - flash: a white screen for whoever looks toward it with no cover in the
//   way (flashTicks below), resolved by the server at the blast.
//
// Who a stun or a flash affects is the friendly-fire rule, `canDamage`:
// teammates are spared in a team deathmatch, and your own stun or flash gets
// you in a duel or a free for all. Everything here is pure and deterministic.

import type { Arena } from "./arena.ts";
import { DEFAULT_GRENADE, FLASH, GRENADES, NO_TEAM, PLAYER_RADIUS, SMOKE, TICK_RATE, ticks, type GrenadeDef } from "./constants.ts";
import { lineOfSight, segmentHitsCircle, type Vec2 } from "./physics.ts";

export function grenadeDef(type: number): GrenadeDef {
  return GRENADES[type] ?? GRENADES[DEFAULT_GRENADE];
}

export function isGrenadeType(type: unknown): type is number {
  return typeof type === "number" && Number.isInteger(type) && type >= 0 && type < GRENADES.length;
}

/** Steps from a throw of this type until the next one is allowed. */
export function grenadeCooldownTicks(type: number): number {
  return ticks(grenadeDef(type).cooldown);
}

/** Distance from a blast at (bx, bz) to the edge of a body at (x, z), as the frag and the stun measure it (0 or less: standing on it). */
export function blastEdge(bx: number, bz: number, x: number, z: number): number {
  return Math.hypot(x - bx, z - bz) - PLAYER_RADIUS;
}

/** The smallest angle between two directions, radians, 0..π. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/**
 * The flash rule: how many ticks of white screen a player standing at
 * `eye`, aiming at `aim` radians, gets from a flash going off at `blast`.
 * 0 when:
 * - the blast is farther than FLASH.range;
 * - cover is in the way (lineOfSight: no flashing through walls);
 * - their aim is FLASH.maxAngle (90°) or more away from the blast, unless it
 *   goes off in their face (closer than FLASH.pointBlank).
 * Otherwise the length is FLASH.maxDuration, times an angle factor (1 aiming
 * straight at it, easing down to 0 at 90°) and a distance factor (1 up to
 * FLASH.fullRange, then down to 0 at FLASH.range). Under FLASH.minDuration it
 * is nothing.
 */
export function flashTicks(arena: Arena, eye: Vec2, aim: number, blast: Vec2): number {
  const dx = blast.x - eye.x;
  const dz = blast.z - eye.z;
  const d = Math.hypot(dx, dz);
  if (d > FLASH.range) return 0;
  if (!lineOfSight(arena, eye, blast)) return 0;
  let angleFactor = 1;
  if (d >= FLASH.pointBlank) {
    const off = angleBetween(Math.atan2(dz, dx), aim);
    if (off >= FLASH.maxAngle) return 0;
    angleFactor = Math.cos((off / FLASH.maxAngle) * (Math.PI / 2));
  }
  const distFactor = d <= FLASH.fullRange ? 1 : 1 - (d - FLASH.fullRange) / (FLASH.range - FLASH.fullRange);
  const seconds = FLASH.maxDuration * angleFactor * distFactor;
  if (seconds < FLASH.minDuration) return 0;
  return Math.round(seconds * TICK_RATE);
}

/**
 * Smoke: whether `target` is hidden from someone standing at `viewer` by any
 * of `clouds` (`radius` each). Hidden when the target is inside a cloud, or
 * when the line from the viewer to the target crosses one (the target is
 * behind it, or the viewer is inside and looks out).
 */
export function smokeHides(viewer: Vec2, target: Vec2, clouds: readonly Vec2[], radius: number = SMOKE.radius): boolean {
  for (const c of clouds) {
    const dx = target.x - c.x;
    const dz = target.z - c.z;
    if (dx * dx + dz * dz < radius * radius) return true;
    if (segmentHitsCircle(viewer, target, c, radius)) return true;
  }
  return false;
}

/**
 * How a player is drawn for one viewer: "none" (as usual), "hidden"
 * (nothing: model, plate, health bar, minimap dot, muzzle flash, the start of
 * their tracers) or "faded" (see-through: what a spectator sees of a player in
 * smoke, since spectators see everything).
 *
 * `hidden`: smoke hides the target from this viewer (smokeHides).
 * `viewerTeam`: null for a spectator. Players always see themselves and
 * their teammates.
 *
 * Client-side only, and that is accepted: the server sends every position to
 * everyone, so a modified client could see through smoke. It's a game
 * between friends, with no anti-cheat.
 */
export type SmokeVeil = "none" | "hidden" | "faded";
export function smokeVeil(viewerTeam: number | null, targetTeam: number, self: boolean, hidden: boolean): SmokeVeil {
  if (!hidden || self) return "none";
  if (viewerTeam === null) return "faded";
  if (viewerTeam !== NO_TEAM && viewerTeam === targetTeam) return "none";
  return "hidden";
}
