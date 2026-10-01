// The player step: movement, dash, weapon (fire / ammo / reload) and ability
// cooldowns for one input. Like physics.ts it is pure and deterministic: the
// server runs it to decide what happens, the client runs it to predict its own
// player (position, dash, shots, cooldown UI). Both must get bit-identical
// results, so: no Math.random, no wall clock, and every piece of state it
// reads is in PlayerSim (which is synced).

import type { Arena } from "./arena.ts";
import {
  BULLET_RADIUS,
  DASH_TICKS,
  DEFAULT_GRENADE,
  DEFAULT_WEAPON,
  GRENADE,
  MAX_HP,
  MELEE,
  MELEE_COOLDOWN_TICKS,
  MELEE_LOCKOUT_TICKS,
  NO_PERK,
  NO_TEAM,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  ROYALE,
  SHIELD_CHARGE_TICKS,
  SHIELD_COOLDOWN_TICKS,
  STUN,
  TICK_DT,
  WEAPONS,
  ticks,
  type GrenadeAffects,
  type WeaponDef,
} from "./constants.ts";
import { grenadeCooldownTicks } from "./grenades.ts";
import { dashCharges, dashCooldownTicks, dashSpeed, magazineOf, reloadTicksOf } from "./perks.ts";
import { clamp, clampMove, lineOfSight, movePlayer, muzzle, type BulletSim, type Vec2 } from "./physics.ts";
import { KIT_KEYS, PLAYER_SIM_KEYS, type InputMessage, type KitSim, type Phase, type PlayerSim } from "./protocol.ts";
import { HEAL_STOP, NO_GUN, canStartHeal, cancelHeal, emptyKit, gunInHand, healing, startHeal, switchGun, tickHeal, useGrenade } from "./royale.ts";

export function weaponDef(id: number): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[DEFAULT_WEAPON];
}

export function isWeaponId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id < WEAPONS.length;
}

/** A weapon the loadout picker offers (not a starting-only gun like the royale's Pistol). */
export function isPickableWeapon(id: unknown): id is number {
  return isWeaponId(id) && WEAPONS[id].pickable !== false;
}

/**
 * What a player carries, which decides how the step reads the gun and the
 * grenade:
 * - "loadout" (duel, FFA, teams): the one gun picked (`weaponId`), and the
 *   grenade on its type's cooldown;
 * - "slots" (battle royale): the gun in the kit's hand slot, a slot switch
 *   on `InputMessage.switch`, and counted grenades (`kit.grenades`) with a
 *   short gap between throws.
 */
export type KitMode = "loadout" | "slots";

/** Ticks a bullet of this weapon lives before it expires (its range). */
export function bulletLifeTicks(w: WeaponDef): number {
  return Math.ceil(w.range / (w.bulletSpeed * TICK_DT));
}

/**
 * A fresh player at (x, z): full magazine, everything off cooldown. `kit`:
 * what they carry in a battle royale (royale.ts' startKit), empty elsewhere.
 * With slots, the gun in the kit's hand is what `ammo` is filled for. The
 * perk is `seen`'s (the server sets the one to spawn with first), else none.
 */
export function spawnSim(x: number, z: number, weapon: number, seen?: PlayerSim, kit: KitSim = emptyKit()): PlayerSim {
  const hand = gunInHand(kit);
  const perk = seen?.perk ?? NO_PERK;
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
    ammo: magazineOf(weaponDef(hand !== NO_GUN ? hand : weapon), perk),
    reloadTicks: 0,
    // Press counters carry over: they track the client's running totals.
    dashSeen: seen?.dashSeen ?? 0,
    grenadeSeen: seen?.grenadeSeen ?? 0,
    shieldSeen: seen?.shieldSeen ?? 0,
    reloadSeen: seen?.reloadSeen ?? 0,
    meleeSeen: seen?.meleeSeen ?? 0,
    burstLeft: 0,
    stunTicks: 0,
    meleeCd: 0,
    // Health is the server's (a spawn sets it on its own): kept as it was.
    hp: seen?.hp ?? MAX_HP,
    perk,
    kit: {
      ...kit,
      switchSeen: seen?.kit.switchSeen ?? kit.switchSeen,
      swapSeen: seen?.kit.swapSeen ?? kit.swapSeen,
      useSeen: seen?.kit.useSeen ?? kit.useSeen,
    },
  };
}

/**
 * A live loadout change (a pick during warmup): `weapon` in hand at once,
 * with a full magazine and nothing of the old gun left over (no reload in
 * progress, no fire interval or burst running), and the grenade ready (its
 * cooldown reset). Position, dash, shield, stun and the press counters are
 * kept. (Spread needs no reset: it is seeded by the input seq, see
 * `shotPellets`, never stored.) The magazine is the perk's: the server puts
 * the picked perk in `sim.perk` first.
 */
export function equipSim(sim: PlayerSim, weapon: number): PlayerSim {
  return { ...sim, ammo: magazineOf(weaponDef(weapon), sim.perk), reloadTicks: 0, fireCd: 0, burstLeft: 0, grenadeCd: 0 };
}

/**
 * What a player may do this step: `act` (move, dash, reload: false while
 * dead or after the match ended) and `armed` (fire, throw a grenade, raise
 * the shield, strike: also false during warmup, so nobody shoots before the match
 * starts). The server and the client's prediction both take it from here.
 */
export interface Can {
  act: boolean;
  armed: boolean;
}

export function playerCan(alive: boolean, phase: Phase | string): Can {
  const act = alive && phase !== "ended";
  return { act, armed: act && phase !== "warmup" };
}

/** Copies a kit out of anything shaped like one (the `Kit` schema, a view): a plain object. */
export function readKit(src: KitSim): KitSim {
  const out = {} as KitSim;
  for (const k of KIT_KEYS) out[k] = src[k];
  return out;
}

/** Copies the sim fields out of anything shaped like a player (schema, view), its kit included. */
export function readSim(src: PlayerSim): PlayerSim {
  const out = {} as PlayerSim;
  for (const k of PLAYER_SIM_KEYS) out[k] = src[k];
  out.kit = readKit(src.kit);
  return out;
}

/** Writes a sim into a player (the schema: its `kit` child is written field by field, never replaced). */
export function writeSim(dst: PlayerSim, sim: PlayerSim) {
  for (const k of PLAYER_SIM_KEYS) dst[k] = sim[k];
  for (const k of KIT_KEYS) dst.kit[k] = sim.kit[k];
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
  /** This input made a melee strike. Who it hits is the server's (`meleeReaches`, against rewound poses). */
  melee: boolean;
  /** Battle royale: this input pressed F (open a chest, or a swap with the floor). The server does it (floor.ts). */
  swap: boolean;
  /** This step moved at dash speed (for visuals). */
  dashing: boolean;
  /** Battle royale: a heal started on this input, and the HP a heal gave on it (0: none completed). */
  healStart: boolean;
  healed: number;
}

const dec = (v: number) => (v > 0 ? v - 1 : 0);

/**
 * Advances a player by one input. `canAct` (see `playerCan`; a boolean sets
 * both) is false while dead or after the match ended: cooldowns still run and
 * presses are still consumed (so a press made while dead doesn't fire on
 * respawn), but nothing moves or happens. Not `armed` (warmup): the player
 * moves, dashes and reloads, but a shot, a grenade or a shield press is used
 * up and does nothing, so none of them goes off when the match starts.
 * `grenadeType` (a GRENADES index, the one in hand) sets the cooldown a throw
 * starts.
 *
 * A stun (`stunTicks` > 0, set by the server when a stun grenade goes off)
 * slows walking to STUN.speedScale, cuts a dash short and blocks new ones; a
 * dash press made meanwhile is used up, like one made during the cooldown.
 * It counts down here, once per input, so the client's prediction slows
 * down exactly with the server.
 *
 * `kit` "slots" (battle royale, see KitMode): the gun is the one in the
 * kit's hand (`weaponId` is ignored), a `switch` press puts the asked slot in
 * hand first (switchGun: its own magazine, no reload carried over, a short
 * delay before it fires), and a grenade needs one left in `kit.grenades`,
 * spends it, and blocks the next throw for ROYALE.throwGap instead of the
 * type's cooldown. The switch is predicted like a shot, so the client fires
 * the right gun from the next input on.
 *
 * Slots also bring the healing items and shield charges (royale.ts, "Healing"):
 * a `use` press starts a heal with `input.heal`, which slows walking to
 * ROYALE.healSpeedScale and blocks the dash until it completes (`healed`:
 * the HP it gave, already in `sim.hp`) or a shot, throw or switch cancels
 * it. The shield needs a charge (`kit.shields`) instead of its cooldown.
 *
 * The perk (`sim.perk`, perks.ts) sets the dash's charges, distance and
 * cooldown, the magazine and the reload (and, with slots, the switch delay):
 * the step reads it from the sim, so the prediction uses the same numbers.
 */
export function stepPlayer(
  arena: Arena,
  prev: PlayerSim,
  input: InputMessage,
  weaponId: number,
  canAct: boolean | Can,
  grenadeType: number = DEFAULT_GRENADE,
  kit: KitMode = "loadout",
): StepResult {
  const { act, armed } = typeof canAct === "boolean" ? { act: canAct, armed: canAct } : canAct;
  const slots = kit === "slots";
  const s: PlayerSim = { ...prev, kit: { ...prev.kit } };
  const res: StepResult = { sim: s, fired: false, grenade: null, shield: false, melee: false, dashing: false, swap: false, healStart: false, healed: 0 };

  const pressDash = input.dash > s.dashSeen;
  const pressGrenade = input.grenade > s.grenadeSeen;
  const pressShield = input.shield > s.shieldSeen;
  const pressReload = input.reload > s.reloadSeen;
  const pressSwitch = (input.switch ?? 0) > s.kit.switchSeen;
  const pressSwap = (input.swap ?? 0) > s.kit.swapSeen;
  const pressUse = (input.use ?? 0) > s.kit.useSeen;
  const pressMelee = (input.melee ?? 0) > s.meleeSeen;
  s.dashSeen = Math.max(s.dashSeen, input.dash);
  s.grenadeSeen = Math.max(s.grenadeSeen, input.grenade);
  s.shieldSeen = Math.max(s.shieldSeen, input.shield);
  s.reloadSeen = Math.max(s.reloadSeen, input.reload);
  s.kit.switchSeen = Math.max(s.kit.switchSeen, input.switch ?? 0);
  s.kit.swapSeen = Math.max(s.kit.swapSeen, input.swap ?? 0);
  s.kit.useSeen = Math.max(s.kit.useSeen, input.use ?? 0);
  s.meleeSeen = Math.max(s.meleeSeen, input.melee ?? 0);

  s.dashCd = dec(s.dashCd);
  s.fireCd = dec(s.fireCd);
  s.grenadeCd = dec(s.grenadeCd);
  s.shieldCd = dec(s.shieldCd);
  s.meleeCd = dec(s.meleeCd);
  const stunned = s.stunTicks > 0;
  s.stunTicks = dec(s.stunTicks);
  // The switch comes first: everything below (reload, fire) is the new gun's.
  const switched = slots && act && pressSwitch && switchGun(s, input.slot ?? -1);
  const hand = slots ? gunInHand(s.kit) : weaponId;
  const w = weaponDef(hand === NO_GUN ? weaponId : hand);
  const magazine = magazineOf(w, s.perk);
  if (s.reloadTicks > 0) {
    s.reloadTicks--;
    if (s.reloadTicks === 0) s.ammo = magazine;
  }

  if (!act) {
    s.dashTicks = 0;
    s.burstLeft = 0;
    cancelHeal(s.kit, 0);
    return res;
  }

  if (pressReload && s.reloadTicks === 0 && s.ammo < magazine) s.reloadTicks = reloadTicksOf(w, s.perk);

  // Healing (slots only, see royale.ts): the heal in progress counts down
  // and completes first, before anything this input does could cancel it.
  // A new one starts with the trigger up and no burst running (either would
  // cancel it at once), and slows this very step.
  if (slots) {
    res.healed = tickHeal(s);
    const item = input.heal ?? -1;
    if (pressUse && armed && !input.fire && s.burstLeft === 0 && canStartHeal(s, item)) {
      startHeal(s, item);
      res.healStart = true;
    }
  }
  const heals = healing(s.kit);

  const move = clampMove(input.mx, input.mz);
  if (stunned || heals) s.dashTicks = 0;
  // Dash charges (perks.ts): `dashCd` is the time until all are back, one
  // cooldown per charge spent, so a dash is allowed while one is back. One
  // charge: a dash needs `dashCd` at 0, the plain cooldown. The cap keeps a
  // perk swapped mid-life (royale) from leaving more than it allows.
  const dashCd = dashCooldownTicks(s.perk);
  const charges = dashCharges(s.perk);
  s.dashCd = Math.min(s.dashCd, charges * dashCd);
  if (pressDash && !stunned && !heals && s.dashCd <= (charges - 1) * dashCd && s.dashTicks === 0) {
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
    s.dashCd += dashCd;
  }

  let p: Vec2;
  if (s.dashTicks > 0) {
    s.dashTicks--;
    res.dashing = true;
    const speed = dashSpeed(s.perk);
    p = movePlayer(arena, s, s.dashDx * speed * TICK_DT, s.dashDz * speed * TICK_DT);
  } else {
    const speed = PLAYER_SPEED * (stunned ? STUN.speedScale : 1) * (heals ? ROYALE.healSpeedScale : 1);
    p = movePlayer(arena, s, move.x * speed * TICK_DT, move.z * speed * TICK_DT);
  }
  s.x = p.x;
  s.z = p.z;

  if (!armed) {
    // Warmup: the trigger, the grenade, the shield and the strike do nothing.
    s.burstLeft = 0;
    return res;
  }

  // The melee strike, before the trigger: it holds the gun for
  // MELEE_LOCKOUT_TICKS (fireCd), this input's shot included, and ends a
  // burst in progress, so a strike and a shot never land together. A reload
  // in progress goes on. Stun doesn't stop it, like it doesn't stop a shot.
  if (pressMelee && s.meleeCd === 0) {
    s.meleeCd = MELEE_COOLDOWN_TICKS;
    s.fireCd = Math.max(s.fireCd, MELEE_LOCKOUT_TICKS);
    s.burstLeft = 0;
    res.melee = true;
  }

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

  if (pressGrenade && s.grenadeCd === 0 && (!slots || s.kit.grenades > 0)) {
    if (slots) {
      s.kit.grenades = useGrenade(s.kit.grenades);
      s.grenadeCd = ticks(ROYALE.throwGap);
    } else s.grenadeCd = grenadeCooldownTicks(grenadeType);
    res.grenade = grenadeTarget(arena, s.x, s.z, input.gx, input.gz);
  }

  if (slots && pressSwap) res.swap = true;

  // Battle royale: the shield uses a charge, and the next waits for this
  // bubble to end plus ROYALE.shieldGap. It never cancels a heal.
  if (pressShield && s.shieldCd === 0 && (!slots || s.kit.shields > 0)) {
    if (slots) s.kit.shields--;
    s.shieldCd = slots ? SHIELD_CHARGE_TICKS : SHIELD_COOLDOWN_TICKS;
    res.shield = true;
  }

  // A shot, a throw, a strike or a switch on this input cancels the heal:
  // nothing healed, the item kept. (An F swap and damage are the server's.)
  if (heals) {
    if (res.fired) cancelHeal(s.kit, HEAL_STOP.fire);
    else if (res.grenade) cancelHeal(s.kit, HEAL_STOP.throw);
    else if (res.melee) cancelHeal(s.kit, HEAL_STOP.melee);
    else if (switched) cancelHeal(s.kit, HEAL_STOP.switch);
  }

  return res;
}

/** One round leaves the gun: ammo, and the auto-reload on empty (which ends a burst). */
function fireRound(s: PlayerSim, w: WeaponDef, res: StepResult) {
  s.ammo--;
  res.fired = true;
  if (s.ammo === 0) {
    s.reloadTicks = reloadTicksOf(w, s.perk); // auto-reload on empty
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

// --- Melee -------------------------------------------------------------------

/**
 * Whether a melee strike from a player at `a` aiming at `aim` reaches a body
 * at `t`: within MELEE.range of `a` (to the body's edge), within half of
 * MELEE.angle of the aim (to its centre), and with no cover box between the
 * two centres (`lineOfSight`: a strike never goes through a wall, however
 * thin). Pure, so the server judges with it (against the rewound poses, like
 * bullets).
 * Teams are not looked at here: that is `canDamage`.
 */
export function meleeReaches(arena: Arena, a: Vec2, aim: number, t: Vec2): boolean {
  const dx = t.x - a.x;
  const dz = t.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist > MELEE.range + PLAYER_RADIUS) return false;
  // Bodies on top of each other: no direction to judge, it reaches.
  if (dist > 1e-6) {
    // The angle between the aim and the target, folded into 0..π.
    const d = Math.atan2(dz, dx) - aim;
    if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > MELEE.angle / 2) return false;
  }
  return lineOfSight(arena, a, t);
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

/**
 * Whether a blast that affects `affects`, thrown by a player on
 * `throwerTeam`, reaches a player on `victimTeam` (`self`: the thrower).
 * "enemies" is exactly `canDamage`. "allies" is the thrower and their
 * teammates, written out on purpose and NOT `!canDamage`: in a duel or a
 * free for all your own frag hurts you (canDamage is true for yourself), yet
 * two NO_TEAM players are never teammates, so there it is the thrower alone.
 */
export function grenadeAffects(affects: GrenadeAffects, throwerTeam: number, victimTeam: number, self: boolean): boolean {
  switch (affects) {
    case "enemies":
      return canDamage(throwerTeam, victimTeam, self);
    case "allies":
      return self || sameTeam(throwerTeam, victimTeam);
  }
}
