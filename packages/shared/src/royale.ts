// The battle royale's own rules, all pure: the gun slots, the grenade
// stacks, the closing zone and the loot table's draw. The server applies them
// (GameRoom, floor.ts) and the client predicts or draws with the same
// functions, so the two never disagree:
//
// - Gun slots (KitSim, protocol.ts): three, the Pistol in slot 1 at the start.
//   A switch is an input the step checks (`switchGun`, run by `stepPlayer`),
//   so the client predicts it exactly and fires the right gun at once. A
//   pickup (`takeGun`) or an F swap (`swapGun`) is the server's, and reaches
//   the prediction with the next snapshot, like any server-side change.
// - Grenade stacks: one type at a time, counted (`takeGrenades`). The step
//   spends one per throw.
// - The zone: `zoneAt` is its circle at a tick, `zoneDamage` what standing
//   outside costs on that tick. Both read the synced ZoneView only.
// - The loot: `rollLoot` draws one LOOT line by weight.
//
// `scripts/royale.check.ts` runs their self-checks (`bun run check`).

import {
  GRENADES,
  ITEM_GRENADE,
  ITEM_GUN,
  LOOT,
  PISTOL,
  ROYALE,
  TICK_RATE,
  WEAPONS,
  ZONE,
  ticks,
  type LootEntry,
} from "./constants.ts";
import type { MapDef } from "./maps/types.ts";
import { fnv1a } from "./modes.ts";
import type { KitSim, PlayerSim, ZoneView } from "./protocol.ts";

/** An empty gun slot (`KitSim.gun0`..`gun2`). */
export const NO_GUN = 255;

/** Gun slot indices, 0 to ROYALE.gunSlots - 1. */
export type GunSlot = 0 | 1 | 2;
const SLOTS: readonly GunSlot[] = [0, 1, 2];

export const isGunSlot = (v: unknown): v is GunSlot => v === 0 || v === 1 || v === 2;

/** Nothing carried: the other modes' kit, which nothing reads. */
export function emptyKit(): KitSim {
  return { hand: 0, gun0: NO_GUN, gun1: NO_GUN, gun2: NO_GUN, mag0: 0, mag1: 0, mag2: 0, grenades: 0, switchSeen: 0, swapSeen: 0 };
}

/** The royale's start: the Pistol in slot 1 (in hand), the other slots empty, no grenades. */
export function startKit(): KitSim {
  return { ...emptyKit(), gun0: PISTOL, mag0: WEAPONS[PISTOL].magazine };
}

export function gunAt(kit: KitSim, slot: number): number {
  return slot === 0 ? kit.gun0 : slot === 1 ? kit.gun1 : slot === 2 ? kit.gun2 : NO_GUN;
}

function setSlot(kit: KitSim, slot: GunSlot, gun: number, mag: number) {
  if (slot === 0) {
    kit.gun0 = gun;
    kit.mag0 = mag;
  } else if (slot === 1) {
    kit.gun1 = gun;
    kit.mag1 = mag;
  } else {
    kit.gun2 = gun;
    kit.mag2 = mag;
  }
}

function storedMag(kit: KitSim, slot: number): number {
  return slot === 0 ? kit.mag0 : slot === 1 ? kit.mag1 : kit.mag2;
}

/** The gun in hand (NO_GUN if that slot is empty, which a royale kit never is). */
export function gunInHand(kit: KitSim): number {
  return gunAt(kit, kit.hand);
}

/** A slot's magazine: the live `ammo` for the gun in hand, the stored one for the others. */
export function magAt(sim: PlayerSim, slot: number): number {
  return slot === sim.kit.hand ? sim.ammo : storedMag(sim.kit, slot);
}

/** The first empty gun slot, or -1 with all three full. */
export function freeGunSlot(kit: KitSim): GunSlot | -1 {
  return SLOTS.find((s) => gunAt(kit, s) === NO_GUN) ?? -1;
}

export function carriesGun(kit: KitSim, weapon: number): boolean {
  return SLOTS.some((s) => gunAt(kit, s) === weapon);
}

/** Guns carried, in slot order. */
export function carriedGuns(sim: PlayerSim): { slot: GunSlot; weapon: number; mag: number }[] {
  return SLOTS.filter((s) => gunAt(sim.kit, s) !== NO_GUN).map((s) => ({ slot: s, weapon: gunAt(sim.kit, s), mag: magAt(sim, s) }));
}

/**
 * Walking over a gun: it goes in the first free slot, with its magazine, and
 * the gun in hand stays in hand. Null (it stays on the floor) with all three
 * slots full (F swaps then, see `swapGun`) or when that gun is carried already
 * (ammo never runs out, so a second one is no use).
 */
export function takeGun(sim: PlayerSim, weapon: number, mag: number): PlayerSim | null {
  const slot = freeGunSlot(sim.kit);
  if (slot === -1 || carriesGun(sim.kit, weapon)) return null;
  const kit = { ...sim.kit };
  setSlot(kit, slot, weapon, mag);
  return { ...sim, kit };
}

/**
 * What a switch or a swap does to the gun that comes in hand: nothing of
 * the old gun's reload or burst carries over, and it can't fire for
 * ROYALE.switchTime (or the old gun's fire interval, if longer), so switching
 * never skips a reload or a fire interval.
 */
function drawGun(s: PlayerSim) {
  s.reloadTicks = 0;
  s.burstLeft = 0;
  s.fireCd = Math.max(s.fireCd, ticks(ROYALE.switchTime));
}

/**
 * F on a gun on the floor, with all three slots full: it takes the place of
 * the gun in hand (with its magazine, in hand at once, after the switch
 * delay), and the old one drops (`dropped`, with its magazine as it was).
 * Null when the floor gun is one already carried.
 */
export function swapGun(sim: PlayerSim, weapon: number, mag: number): { sim: PlayerSim; dropped: { weapon: number; mag: number } } | null {
  if (carriesGun(sim.kit, weapon) || !isGunSlot(sim.kit.hand)) return null;
  const old = { weapon: gunInHand(sim.kit), mag: sim.ammo };
  const s: PlayerSim = { ...sim, kit: { ...sim.kit }, ammo: mag };
  setSlot(s.kit, sim.kit.hand, weapon, mag);
  drawGun(s);
  return { sim: s, dropped: old };
}

/**
 * Puts the gun in `slot` in hand, in place (the step's copy): the magazine
 * in hand is stored in its slot, the new one's comes out. Every gun keeps
 * its own magazine; a reload in progress is cancelled, the magazine left as
 * it was. Nothing happens for the slot already in hand, an empty slot or a
 * bad index. Returns whether it switched.
 */
export function switchGun(s: PlayerSim, slot: number): boolean {
  if (!isGunSlot(slot) || slot === s.kit.hand || gunAt(s.kit, slot) === NO_GUN) return false;
  const kit = s.kit;
  setSlot(kit, kit.hand as GunSlot, gunInHand(kit), s.ammo);
  s.ammo = storedMag(kit, slot);
  kit.hand = slot;
  drawGun(s);
  return true;
}

/** The mouse wheel: the next (`dir` 1) or previous carried slot from the one in hand, skipping empty ones. */
export function cycleSlot(kit: KitSim, dir: 1 | -1): number {
  const n = ROYALE.gunSlots;
  for (let i = 1; i < n; i++) {
    const s = (((kit.hand + dir * i) % n) + n) % n;
    if (gunAt(kit, s) !== NO_GUN) return s;
  }
  return kit.hand;
}

// --- Grenade stacks --------------------------------------------------------------

/** The most of a grenade type one player carries (GrenadeDef.stack). */
export function grenadeStack(type: number): number {
  return GRENADES[type]?.stack ?? 0;
}

/** A grenade type and a count: the one in hand, or a stack on the floor. */
export interface GrenadeStack {
  type: number;
  count: number;
}

/**
 * Walking over a stack of grenades, with `held` in hand:
 * - the same type (or none held): added, up to the type's `stack`;
 * - another type: it swaps in (up to its `stack`), and the held stack drops.
 * Returns what is held now, how many stay on the floor (0: the floor stack is
 * gone), and the stack dropped by a swap (null if none). `taken` 0 means
 * nothing happened (already at the maximum): the floor stack stays as it was.
 */
export function takeGrenades(held: GrenadeStack, floor: GrenadeStack): { held: GrenadeStack; left: number; dropped: GrenadeStack | null; taken: number } {
  const max = grenadeStack(floor.type);
  if (held.count > 0 && held.type !== floor.type) {
    const taken = Math.min(max, floor.count);
    return { held: { type: floor.type, count: taken }, left: floor.count - taken, dropped: { ...held }, taken };
  }
  const have = held.count > 0 ? held.count : 0;
  const taken = Math.max(0, Math.min(max - have, floor.count));
  return { held: { type: floor.type, count: have + taken }, left: floor.count - taken, dropped: null, taken };
}

/** A throw from a stack: one fewer, never below 0 (at 0 there is nothing to throw, see stepPlayer). */
export function useGrenade(count: number): number {
  return Math.max(0, count - 1);
}

// --- The zone --------------------------------------------------------------------------

/** A circle on the ground. */
export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** How far through its shrink the zone is at `tick`: 0 until `start`, 1 from `end` on. */
export function zoneProgress(zone: ZoneView, tick: number): number {
  if (zone.end <= zone.start) return tick >= zone.end ? 1 : 0;
  return Math.min(1, Math.max(0, (tick - zone.start) / (zone.end - zone.start)));
}

/**
 * The zone's circle at `tick` (a fraction is fine: the client draws between
 * ticks). Null with no zone (`end` 0). Linear from the start circle to the
 * end one: smooth, no steps.
 */
export function zoneAt(zone: ZoneView, tick: number): Circle | null {
  if (zone.end <= 0) return null;
  const t = zoneProgress(zone, tick);
  return { x: zone.x0 + (zone.x1 - zone.x0) * t, z: zone.z0 + (zone.z1 - zone.z0) * t, r: Math.max(0, zone.r0 + (zone.r1 - zone.r0) * t) };
}

/** Standing outside the zone at `tick` (never with no zone). The centre is what counts, not the body's edge. */
export function outsideZone(zone: ZoneView, tick: number, x: number, z: number): boolean {
  const c = zoneAt(zone, tick);
  if (!c) return false;
  return Math.hypot(x - c.x, z - c.z) > c.r;
}

/**
 * Damage per second outside the zone at `tick`: ZONE.dpsStart when it starts
 * shrinking, rising linearly to ZONE.dpsEnd once it is closed, and staying
 * there. 0 before it shrinks (nobody can be outside then anyway).
 */
export function zoneDps(zone: ZoneView, tick: number): number {
  if (zone.end <= 0 || tick < zone.start) return 0;
  return ZONE.dpsStart + (ZONE.dpsEnd - ZONE.dpsStart) * zoneProgress(zone, tick);
}

/** All the damage standing outside since the shrink started would have done by `tick` (the integral of zoneDps). */
function zoneDose(zone: ZoneView, tick: number): number {
  if (zone.end <= 0 || tick <= zone.start) return 0;
  const s = (tick - zone.start) / TICK_RATE;
  const c = Math.max(1e-9, (zone.end - zone.start) / TICK_RATE);
  const a = ZONE.dpsStart;
  const b = ZONE.dpsEnd;
  if (s <= c) return a * s + ((b - a) * s * s) / (2 * c);
  return a * c + ((b - a) * c) / 2 + b * (s - c);
}

/**
 * Whole HP standing outside the zone costs on `tick`: the dose's integer part
 * gained since the previous tick. So it is dealt every tick in small whole
 * steps (HP is an integer), sums to exactly the dose over time, and grows as
 * the zone closes. Pure: the same on every machine.
 */
export function zoneDamage(zone: ZoneView, tick: number): number {
  return Math.floor(zoneDose(zone, tick)) - Math.floor(zoneDose(zone, tick - 1));
}

/** The seed's `salt` draw, in [0, 1). */
const draw01 = (seed: string, salt: string) => fnv1a(`${seed}:${salt}`) / 4294967296;

/**
 * The zone of a match on `map`: centred on the map at first, wide enough to
 * cover every corner, shrinking from `startTick` to nothing at `endTick`,
 * round a final centre drawn from the match seed inside the map's
 * `royale.zone` limits (so it isn't always the middle, and it is
 * reproducible from the match id).
 */
export function pickZone(map: MapDef, seed: string, startTick: number, endTick: number): ZoneView {
  const lim = map.royale?.zone ?? { x0: 0, z0: 0, x1: 0, z1: 0 };
  const u = draw01(seed, "zone-x");
  const v = draw01(seed, "zone-z");
  return {
    x0: 0,
    z0: 0,
    x1: lim.x0 + (lim.x1 - lim.x0) * u,
    z1: lim.z0 + (lim.z1 - lim.z0) * v,
    r0: Math.hypot(map.halfX, map.halfZ) + ZONE.margin,
    r1: 0,
    start: startTick,
    end: endTick,
  };
}

// --- Loot ------------------------------------------------------------------------------

/** One item for the floor: an ITEM_KINDS index, which one, and how many. */
export interface ItemDrop {
  kind: number;
  item: number;
  amount: number;
}

/** The floor item a loot line gives (a gun with a full magazine, a stack). */
export function lootItem(e: LootEntry): ItemDrop {
  if (e.kind === "gun") {
    const id = WEAPONS.findIndex((w) => w.key === e.key);
    return { kind: ITEM_GUN, item: id, amount: WEAPONS[id].magazine };
  }
  return { kind: ITEM_GRENADE, item: GRENADES.findIndex((g) => g.key === e.key), amount: e.amount };
}

/** A crate's drop: the LOOT line `r` (in [0, 1), e.g. Math.random()) lands on, by weight. */
export function rollLoot(r: number, table: readonly LootEntry[] = LOOT): ItemDrop {
  const total = table.reduce((n, e) => n + e.weight, 0);
  let at = Math.min(Math.max(r, 0), 0.999999) * total;
  for (const e of table) {
    if (at < e.weight) return lootItem(e);
    at -= e.weight;
  }
  return lootItem(table[table.length - 1]);
}
