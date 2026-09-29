// The player step: movement, dash, weapon (fire / ammo / reload) and ability
// cooldowns for one input. Like physics.ts it is pure and deterministic: the
// server runs it to decide what happens, the client runs it to predict its own
// player (position, dash, shots, cooldown UI). Both must get bit-identical
// results, so: no Math.random, no wall clock, and every piece of state it
// reads is in PlayerSim (which is synced).

import type { Arena } from "./arena.ts";
import {
  BULLET_RADIUS,
  DASH_COOLDOWN_TICKS,
  DASH_SPEED,
  DASH_TICKS,
  DEFAULT_GRENADE,
  DEFAULT_WEAPON,
  GRENADE,
  NO_TEAM,
  PLAYER_SPEED,
  SHIELD_COOLDOWN_TICKS,
  STUN,
  TICK_DT,
  WEAPONS,
  ticks,
  type WeaponDef,
} from "./constants.ts";
import { grenadeCooldownTicks } from "./grenades.ts";
import { clamp, clampMove, movePlayer, muzzle, type BulletSim, type Vec2 } from "./physics.ts";
import { PLAYER_SIM_KEYS, type InputMessage, type PlayerSim } from "./protocol.ts";

export function weaponDef(id: number): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[DEFAULT_WEAPON];
}

export function isWeaponId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id < WEAPONS.length;
}

/** Ticks a bullet of this weapon lives before it expires (its range). */
export function bulletLifeTicks(w: WeaponDef): number {
  return Math.ceil(w.range / (w.bulletSpeed * TICK_DT));
}

/** A fresh player at (x, z): full magazine, everything off cooldown. */
export function spawnSim(x: number, z: number, weapon: number, seen?: PlayerSim): PlayerSim {
  return {
    x,
    z,
    dashTicks: 0,
    dashDx: 0,
    dashDz: 0,
    dashCd: 0,
    fireCd: 0,
    grenadeCd: 0,
    shieldCd: 0,
    ammo: weaponDef(weapon).magazine,
    reloadTicks: 0,
    // Press counters carry over: they track the client's running totals.
    dashSeen: seen?.dashSeen ?? 0,
    grenadeSeen: seen?.grenadeSeen ?? 0,
    shieldSeen: seen?.shieldSeen ?? 0,
    reloadSeen: seen?.reloadSeen ?? 0,
    burstLeft: 0,
    stunTicks: 0,
  };
}

/** Copies the sim fields out of anything shaped like a player (schema, view). */
export function readSim(src: PlayerSim): PlayerSim {
  const out = {} as PlayerSim;
  for (const k of PLAYER_SIM_KEYS) out[k] = src[k];
  return out;
}

export function writeSim(dst: PlayerSim, sim: PlayerSim) {
  for (const k of PLAYER_SIM_KEYS) dst[k] = sim[k];
}

export interface StepResult {
  sim: PlayerSim;
  /**
   * This input fired a shot (spawn `shotPellets`). With a burst weapon each
   * round is its own shot, fired by its own input, so bullet ids stay unique.
   */
  fired: boolean;
  /** This input threw a grenade at this (already range-clamped) point. */
  grenade: Vec2 | null;
  /** This input activated the shield. */
  shield: boolean;
  /** This step moved at dash speed (for visuals). */
  dashing: boolean;
}

const dec = (v: number) => (v > 0 ? v - 1 : 0);

/**
 * Advances a player by one input. `canAct` is false while dead or after the
 * match ended: cooldowns still run and presses are still consumed (so a press
 * made while dead doesn't fire on respawn), but nothing moves or happens.
 * `grenadeType` (a GRENADES index, the one in hand) sets the cooldown a throw
 * starts.
 *
 * A stun (`stunTicks` > 0, set by the server when a stun grenade goes off)
 * slows walking to STUN.speedScale, cuts a dash short and blocks new ones; a
 * dash press made meanwhile is used up, like one made during the cooldown.
 * It counts down here, once per input, so the client's prediction slows
 * down exactly with the server.
 */
export function stepPlayer(
  arena: Arena,
  prev: PlayerSim,
  input: InputMessage,
  weaponId: number,
  canAct: boolean,
  grenadeType: number = DEFAULT_GRENADE,
): StepResult {
  const w = weaponDef(weaponId);
  const s: PlayerSim = { ...prev };
  const res: StepResult = { sim: s, fired: false, grenade: null, shield: false, dashing: false };

  const pressDash = input.dash > s.dashSeen;
  const pressGrenade = input.grenade > s.grenadeSeen;
  const pressShield = input.shield > s.shieldSeen;
  const pressReload = input.reload > s.reloadSeen;
  s.dashSeen = Math.max(s.dashSeen, input.dash);
  s.grenadeSeen = Math.max(s.grenadeSeen, input.grenade);
  s.shieldSeen = Math.max(s.shieldSeen, input.shield);
  s.reloadSeen = Math.max(s.reloadSeen, input.reload);

  s.dashCd = dec(s.dashCd);
  s.fireCd = dec(s.fireCd);
  s.grenadeCd = dec(s.grenadeCd);
  s.shieldCd = dec(s.shieldCd);
  const stunned = s.stunTicks > 0;
  s.stunTicks = dec(s.stunTicks);
  if (s.reloadTicks > 0) {
    s.reloadTicks--;
    if (s.reloadTicks === 0) s.ammo = w.magazine;
  }

  if (!canAct) {
    s.dashTicks = 0;
    s.burstLeft = 0;
    return res;
  }

  if (pressReload && s.reloadTicks === 0 && s.ammo < w.magazine) s.reloadTicks = ticks(w.reloadTime);

  const move = clampMove(input.mx, input.mz);
  if (stunned) s.dashTicks = 0;
  if (pressDash && !stunned && s.dashCd === 0 && s.dashTicks === 0) {
    // Move direction if moving, otherwise where we're facing.
    const len = Math.sqrt(move.x * move.x + move.z * move.z);
    if (len > 1e-3) {
      s.dashDx = move.x / len;
      s.dashDz = move.z / len;
    } else {
      s.dashDx = Math.cos(input.aim);
      s.dashDz = Math.sin(input.aim);
    }
    s.dashTicks = DASH_TICKS;
    s.dashCd = DASH_COOLDOWN_TICKS;
  }

  let p: Vec2;
  if (s.dashTicks > 0) {
    s.dashTicks--;
    res.dashing = true;
    p = movePlayer(arena, s, s.dashDx * DASH_SPEED * TICK_DT, s.dashDz * DASH_SPEED * TICK_DT);
  } else {
    const speed = stunned ? PLAYER_SPEED * STUN.speedScale : PLAYER_SPEED;
    p = movePlayer(arena, s, move.x * speed * TICK_DT, move.z * speed * TICK_DT);
  }
  s.x = p.x;
  s.z = p.z;

  if (s.burstLeft > 0) {
    // A burst in progress: the next round is due once fireCd (set at the
    // burst's first round) has run down by one more burst interval. It needs
    // no button: a started burst finishes. A reload or an empty magazine ends it.
    const burst = w.burst ?? 1;
    const due = ticks(w.fireInterval) - (burst - s.burstLeft) * ticks(w.burstInterval ?? 0);
    if (s.reloadTicks > 0 || s.ammo === 0) s.burstLeft = 0;
    else if (s.fireCd <= due) {
      s.burstLeft--;
      fireRound(s, w, res);
    }
  } else if (input.fire && s.fireCd === 0 && s.reloadTicks === 0 && s.ammo > 0) {
    s.fireCd = ticks(w.fireInterval);
    s.burstLeft = (w.burst ?? 1) - 1;
    fireRound(s, w, res);
  }

  if (pressGrenade && s.grenadeCd === 0) {
    s.grenadeCd = grenadeCooldownTicks(grenadeType);
    res.grenade = grenadeTarget(arena, s.x, s.z, input.gx, input.gz);
  }

  if (pressShield && s.shieldCd === 0) {
    s.shieldCd = SHIELD_COOLDOWN_TICKS;
    res.shield = true;
  }

  return res;
}

/** One round leaves the gun: ammo, and the auto-reload on empty (which ends a burst). */
function fireRound(s: PlayerSim, w: WeaponDef, res: StepResult) {
  s.ammo--;
  res.fired = true;
  if (s.ammo === 0) {
    s.reloadTicks = ticks(w.reloadTime); // auto-reload on empty
    s.burstLeft = 0;
  }
}

// --- Shots -------------------------------------------------------------------

/**
 * Small integer hash -> [0, 1). Seeded by (seq, pellet) so a given shot always
 * spreads the same way on the client and the server. Integer maths only, so it
 * is bit-exact in every JS engine.
 */
export function hash01(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function bulletId(slot: number, seq: number, pellet: number): string {
  return `${slot}:${seq}:${pellet}`;
}

/**
 * The bullets a shot fired by input `seq` spawns, from a player at (x, z)
 * aiming at `aim`. Multi-pellet weapons spread their pellets evenly over the
 * cone plus a little seeded jitter, single-bullet weapons get a seeded offset.
 */
export function shotPellets(weaponId: number, x: number, z: number, aim: number, seq: number): BulletSim[] {
  const w = weaponDef(weaponId);
  const origin = muzzle(x, z, aim);
  const out: BulletSim[] = [];
  for (let i = 0; i < w.pellets; i++) {
    const u = hash01(seq, i) - 0.5;
    const a =
      w.pellets === 1
        ? aim + u * w.spread
        : aim + ((i + 0.5) / w.pellets - 0.5) * w.spread + u * (w.spread / w.pellets);
    out.push({ x: origin.x, z: origin.z, vx: Math.cos(a) * w.bulletSpeed, vz: Math.sin(a) * w.bulletSpeed });
  }
  return out;
}

// --- Grenades ----------------------------------------------------------------

/** Where a grenade thrown from (x, z) at (gx, gz) lands: within range, inside the arena. */
export function grenadeTarget(arena: Arena, x: number, z: number, gx: number, gz: number): Vec2 {
  let dx = (Number.isFinite(gx) ? gx : x) - x;
  let dz = (Number.isFinite(gz) ? gz : z) - z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > GRENADE.range) {
    dx *= GRENADE.range / len;
    dz *= GRENADE.range / len;
  }
  const limX = arena.halfX - BULLET_RADIUS;
  const limZ = arena.halfZ - BULLET_RADIUS;
  return { x: clamp(x + dx, -limX, limX), z: clamp(z + dz, -limZ, limZ) };
}

export function grenadeFlightTicks(distance: number): number {
  return Math.max(ticks(GRENADE.minFlight), Math.ceil(distance / GRENADE.flightSpeed / TICK_DT));
}

/** Position along the lob, `t` from 0 (thrown) to 1 (landed). */
export function grenadeArc(ox: number, oz: number, tx: number, tz: number, t: number): { x: number; y: number; z: number } {
  const dist = Math.hypot(tx - ox, tz - oz);
  const apex = GRENADE.arcBase + GRENADE.arcPerMetre * dist;
  const launchY = 1.1;
  // Parabola from launch height to the ground, peaking around the middle.
  const y = (1 - t) * launchY + 4 * apex * t * (1 - t);
  return { x: ox + (tx - ox) * t, y: Math.max(0, y), z: oz + (tz - oz) * t };
}

/**
 * Frag blast damage at `distance` metres from the centre to the edge of a
 * body (0 = standing on it). Null outside the radius. (The other grenade
 * types deal no damage, see grenades.ts.)
 */
export function grenadeDamage(distance: number, self: boolean): number | null {
  if (distance > GRENADE.radius) return null;
  const t = Math.max(0, distance) / GRENADE.radius;
  const dmg = GRENADE.maxDamage - (GRENADE.maxDamage - GRENADE.minDamage) * t;
  return Math.round(self ? dmg * GRENADE.selfDamageScale : dmg);
}

// --- Teams -------------------------------------------------------------------

/** Two players on the same team (never true outside a team mode: everyone is NO_TEAM there). */
export function sameTeam(a: number, b: number): boolean {
  return a !== NO_TEAM && a === b;
}

/**
 * Whether a hit from a player on `attackerTeam` hurts a player on
 * `victimTeam`; `self` when it is the attacker's own grenade. The one rule
 * for friendly fire, used by the server's bullets, grenades and damage, and by
 * the client's predicted bullets (which fly through whoever this spares, like
 * the server's do). Outside a team mode both teams are NO_TEAM, so everything
 * hurts, your own grenade included, exactly as before. In a team mode nothing
 * hurts a teammate, and your own grenade doesn't hurt you.
 */
export function canDamage(attackerTeam: number, victimTeam: number, self: boolean): boolean {
  if (self) return victimTeam === NO_TEAM;
  return !sameTeam(attackerTeam, victimTeam);
}
