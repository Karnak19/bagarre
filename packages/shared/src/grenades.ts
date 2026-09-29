// The grenade types (GRENADES in constants.ts): what each one does when
// it goes off. They share the throw (grenadeTarget / grenadeArc /
// grenadeFlightTicks in combat.ts) and differ only in their blast:
//
// - frag: damage with falloff (grenadeDamage, combat.ts). The only one that
//   hurts or kills, and the only one the kill feed calls "Grenade".
// - smoke: a cloud on the ground for SMOKE.duration. Who is in it, or behind
//   it, is hidden from their enemies (smokeHides / smokeVeil below).
// - stun: `stunTicks` on everyone in the radius; `stepPlayer` slows them and
//   blocks their dash while it runs.
// - flash: a white screen for anyone with no cover in the way, longest for
//   whoever looks toward it and shorter with their back turned (flashTicks below), resolved by the server at the blast.
// - heal: an instant HEAL.amount of health (healAmount below) for the
//   thrower and their teammates in the radius, with no cover in the way.
//
// Who a blast affects is its def's `affects` (grenadeAffects, combat.ts). For
// the frag, smoke, stun and flash that is "enemies", the friendly-fire rule
// `canDamage`: teammates are spared in a team deathmatch, and your own
// grenade gets you in a duel or a free for all. For the heal it is "allies":
// the thrower and their teammates, so only the thrower in a duel or a free
// for all. Everything here is pure and deterministic.

import type { Arena } from "./arena.ts";
import { DEFAULT_GRENADE, FLASH, GRENADES, HEAL, MAX_HP, NO_TEAM, PLAYER_RADIUS, SMOKE, TICK_RATE, ticks, type GrenadeDef } from "./constants.ts";
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
 * - the length works out under FLASH.minDuration (see below).
 * Turning away never cancels it: the length is FLASH.maxDuration, times an
 * angle factor (1 aiming straight at it, easing down to FLASH.backFactor at
 * 180°) and a distance factor (1 up to FLASH.fullRange, then down to 0 at
 * FLASH.range). Closer than FLASH.pointBlank the aim does not matter (angle
 * factor 1). Under FLASH.minDuration it is nothing, so far away and turned
 * away can still come out at 0.
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
    angleFactor = FLASH.backFactor + (1 - FLASH.backFactor) * Math.cos((off / Math.PI) * (Math.PI / 2));
  }
  const distFactor = d <= FLASH.fullRange ? 1 : 1 - (d - FLASH.fullRange) / (FLASH.range - FLASH.fullRange);
  const seconds = FLASH.maxDuration * angleFactor * distFactor;
  if (seconds < FLASH.minDuration) return 0;
  return Math.round(seconds * TICK_RATE);
}

/**
 * The heal rule: how much HP a player at `pos` with `hp` gets back from a
 * heal going off at `blast`, for a player the blast may affect (grenadeAffects
 * "allies"). 0 when:
 * - they are dead or respawning (hp 0: a heal never brings anyone back);
 * - the blast is farther than HEAL.radius from the edge of their body
 *   (blastEdge, as the frag and the stun measure it);
 * - cover is in the way (lineOfSight: no healing through walls).
 * Otherwise HEAL.amount, the same across the whole radius, capped so HP never
 * goes over MAX_HP (`hp` is a uint8 on the wire). The shield is not touched.
 */
export function healAmount(arena: Arena, pos: Vec2, hp: number, blast: Vec2): number {
  if (hp <= 0 || hp >= MAX_HP) return 0;
  if (blastEdge(blast.x, blast.z, pos.x, pos.z) > HEAL.radius) return 0;
  if (!lineOfSight(arena, blast, pos)) return 0;
  return Math.min(HEAL.amount, MAX_HP - hp);
}

/** A smoke cloud with the side that threw it (SmokeView has both). */
export interface OwnedCloud extends Vec2 {
  /** Session id of the thrower. */
  owner: string;
  /** The thrower's team, NO_TEAM in a duel or free for all. */
  team: number;
}

/**
 * Whether the viewer's side threw this cloud: they threw it themselves, or
 * (in teams) a teammate did. In a duel or free for all (NO_TEAM) only the
 * thrower counts. A spectator (`viewerId` null) owns none.
 */
export function ownsCloud(viewerId: string | null, viewerTeam: number | null, cloud: { owner: string; team: number }): boolean {
  if (viewerId === null) return false;
  if (cloud.owner === viewerId) return true;
  return viewerTeam !== null && viewerTeam !== NO_TEAM && cloud.team === viewerTeam;
}

/**
 * Smoke between a viewer and a target: "none", "own" (every cloud in the way
 * is one the viewer's side threw: they see through it, faded) or "foreign"
 * (at least one cloud in the way is not theirs: hidden). `mine` says whether
 * each cloud is the viewer's (ownsCloud).
 *
 * A cloud is in the way when the target is inside it, or when the line from
 * the viewer to the target crosses it (the target is behind it, or the viewer
 * is inside and looks out).
 */
export type SmokeCover = "none" | "own" | "foreign";
export function smokeCover(
  viewer: Vec2,
  target: Vec2,
  clouds: readonly (Vec2 & { mine?: boolean })[],
  radius: number = SMOKE.radius,
): SmokeCover {
  let cover: SmokeCover = "none";
  for (const c of clouds) {
    const dx = target.x - c.x;
    const dz = target.z - c.z;
    if (dx * dx + dz * dz >= radius * radius && !segmentHitsCircle(viewer, target, c, radius)) continue;
    if (!c.mine) return "foreign";
    cover = "own";
  }
  return cover;
}

/** Whether any cloud of `clouds` hides `target` from `viewer` (smokeCover, ignoring who owns what). */
export function smokeHides(viewer: Vec2, target: Vec2, clouds: readonly Vec2[], radius: number = SMOKE.radius): boolean {
  return smokeCover(viewer, target, clouds, radius) !== "none";
}

/**
 * How a player is drawn for one viewer: "none" (as usual), "hidden"
 * (nothing: model, plate, health bar, minimap dot, muzzle flash, the start of
 * their tracers) or "faded" (see-through: what a spectator sees of a player in
 * smoke, since spectators see everything, and what the thrower's side sees of
 * an enemy in their own cloud).
 *
 * `cover`: the smoke between this viewer and the target (smokeCover).
 * `viewerTeam`: null for a spectator. Players always see themselves and
 * their teammates.
 *
 * Client-side only, and that is accepted: the server sends every position to
 * everyone, so a modified client could see through smoke. It's a game
 * between friends, with no anti-cheat.
 */
export type SmokeVeil = "none" | "hidden" | "faded";
export function smokeVeil(viewerTeam: number | null, targetTeam: number, self: boolean, cover: SmokeCover): SmokeVeil {
  if (cover === "none" || self) return "none";
  if (viewerTeam === null) return "faded";
  if (viewerTeam !== NO_TEAM && viewerTeam === targetTeam) return "none";
  return cover === "own" ? "faded" : "hidden";
}
