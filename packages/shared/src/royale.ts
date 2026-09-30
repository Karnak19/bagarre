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
//   `swapTarget` is which floor gun an F press takes: the server swaps with
//   it, and the client's HUD shows it before the press.
// - Grenade stacks: one type at a time, counted (`takeGrenades`). The step
//   spends one per throw.
// - The zone: `zoneAt` is its circle at a tick, `zoneDamage` what standing
//   outside costs on that tick. Both read the synced ZoneView only.
// - Healing items and shield charges: counted stacks (`takeStack`), used
//   by the step (the heal on `InputMessage.use`, a charge on the shield
//   press). See "Healing" below for the rules and their order.
// - The loot: `rollLoot` draws one LOOT line by weight.
//
// `scripts/royale.check.ts` runs their self-checks (`bun run check`).

import {
  GRENADES,
  HEAL_BANDAGE,
  HEAL_ITEMS,
  HEAL_MEDKIT,
  ITEM_GRENADE,
  ITEM_GUN,
  ITEM_HEAL,
  ITEM_SHIELD,
  LOOT,
  MAX_HP,
  NO_HEAL,
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
import type { FloorItemView, KitSim, MapLike, PlayerSim, ZoneView } from "./protocol.ts";

/** An empty gun slot (`KitSim.gun0`..`gun2`). */
export const NO_GUN = 255;

/** Gun slot indices, 0 to ROYALE.gunSlots - 1. */
export type GunSlot = 0 | 1 | 2;
const SLOTS: readonly GunSlot[] = [0, 1, 2];

export const isGunSlot = (v: unknown): v is GunSlot => v === 0 || v === 1 || v === 2;

/** Nothing carried: the other modes' kit, which nothing reads. */
export function emptyKit(): KitSim {
  return {
    hand: 0,
    gun0: NO_GUN,
    gun1: NO_GUN,
    gun2: NO_GUN,
    mag0: 0,
    mag1: 0,
    mag2: 0,
    grenades: 0,
    switchSeen: 0,
    swapSeen: 0,
    bandages: 0,
    medkits: 0,
    shields: 0,
    heal: NO_HEAL,
    healTicks: 0,
    healStop: 0,
    useSeen: 0,
  };
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
 * The floor gun an F press swaps with, for a player at (x, z) carrying
 * `kit`: the nearest gun within ROYALE.pickupRadius that isn't blocked for
 * them (`blockedFor`, they dropped it and haven't stepped off it yet; the
 * first one met wins a tie). Null when there is none, when that nearest gun
 * is one already carried (F then does nothing, even with another gun
 * further off), or when the hand isn't a gun slot: exactly when `swapGun`
 * would refuse it. The server's F (floor.ts) swaps with this one, and the
 * HUD's swap prompt names it, so the two never disagree. It doesn't check
 * for a free slot: with one, walking over a gun already picks it up.
 */
export function swapTarget<T extends FloorItemView>(kit: KitSim, x: number, z: number, items: MapLike<T>, pid: string): { id: string; item: T } | null {
  let best: { id: string; item: T; d: number } | null = null;
  items.forEach((item, id) => {
    if (item.kind !== ITEM_GUN || item.blockedFor === pid) return;
    const d = Math.hypot(x - item.x, z - item.z);
    if (d <= ROYALE.pickupRadius && (!best || d < best.d)) best = { id, item, d };
  });
  const pick = best as { id: string; item: T; d: number } | null;
  if (!pick || carriesGun(kit, pick.item.item) || !isGunSlot(kit.hand)) return null;
  return { id: pick.id, item: pick.item };
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

// --- Healing and shield charges ------------------------------------------------------
//
// The rules, all applied by `stepPlayer` (combat.ts) in slots mode, so the
// client predicts them (the slowdown above all) exactly like the server:
// - A heal starts on a `use` press for an item carried, below MAX_HP, with
//   none in progress, the trigger up and no burst running. Not in warmup.
// - While it runs the player walks at ROYALE.healSpeedScale and can't dash.
//   It counts down one step per input, like a stun.
// - It completes when its steps run out: `amount` HP, capped at MAX_HP, and
//   only then is the item used up.
// - A shot, a throw or a gun switch (the step's), an F swap or damage to HP
//   (the server's: damage the shield soaks doesn't count) cancel it: nothing
//   healed, the item kept. The shield doesn't cancel it.
// - Same tick: a heal that is due completes first. The step runs the
//   countdown before the shot or throw of that input, and the server applies
//   every input of a tick before bullets, blasts and the zone. So a heal
//   never lands twice, and it's never used up without healing.

/** How a heal ended (`KitSim.healStop`; 0 before the first one). */
export const HEAL_STOP = {
  done: 1,
  /** Damage to HP (bullets, blasts). */
  hurt: 2,
  /** Damage from standing outside the zone. */
  zone: 3,
  fire: 4,
  throw: 5,
  /** A gun switch, or an F swap. */
  switch: 6,
} as const;

/** A HEAL_ITEMS index. */
export const isHealItem = (v: unknown): v is number => v === HEAL_BANDAGE || v === HEAL_MEDKIT;

/** How many of that healing item the kit carries. */
export function healsOf(kit: KitSim, item: number): number {
  return item === HEAL_BANDAGE ? kit.bandages : item === HEAL_MEDKIT ? kit.medkits : 0;
}

function setHeals(kit: KitSim, item: number, n: number) {
  if (item === HEAL_BANDAGE) kit.bandages = n;
  else if (item === HEAL_MEDKIT) kit.medkits = n;
}

/** A heal is in progress. */
export const healing = (kit: KitSim) => kit.heal !== NO_HEAL;

/** How far the heal in progress is, 0..1 (0 with none). */
export function healProgress(kit: KitSim): number {
  const def = HEAL_ITEMS[kit.heal];
  if (!def) return 0;
  return 1 - kit.healTicks / ticks(def.duration);
}

/**
 * Whether a heal with `item` may start now (the step's own checks on its
 * copy: the rest, like the trigger and the phase, is the step's).
 */
export function canStartHeal(s: PlayerSim, item: number): boolean {
  return isHealItem(item) && !healing(s.kit) && healsOf(s.kit, item) > 0 && s.hp < MAX_HP;
}

/** Starts a heal with `item`, in place (check canStartHeal first). */
export function startHeal(s: PlayerSim, item: number) {
  s.kit.heal = item;
  s.kit.healTicks = ticks(HEAL_ITEMS[item].duration);
  s.kit.healStop = 0;
}

/**
 * One step of the heal in progress, in place: the countdown, and the heal
 * once it runs out (the item used up, `amount` HP up to MAX_HP). Returns the
 * HP it gave (0 while still running, or with none).
 */
export function tickHeal(s: PlayerSim): number {
  if (!healing(s.kit)) return 0;
  s.kit.healTicks = Math.max(0, s.kit.healTicks - 1);
  if (s.kit.healTicks > 0) return 0;
  const item = s.kit.heal;
  const before = s.hp;
  s.hp = Math.min(MAX_HP, s.hp + HEAL_ITEMS[item].amount);
  setHeals(s.kit, item, Math.max(0, healsOf(s.kit, item) - 1));
  s.kit.heal = NO_HEAL;
  s.kit.healStop = HEAL_STOP.done;
  return s.hp - before;
}

/** Cancels the heal in progress, in place (on anything shaped like a kit, the schema too): nothing healed, the item kept. */
export function cancelHeal(kit: KitSim, why: number): boolean {
  if (kit.heal === NO_HEAL) return false;
  kit.heal = NO_HEAL;
  kit.healTicks = 0;
  kit.healStop = why;
  return true;
}

/** The most of a floor stack's kind one player carries (healing items, shield charges; 0 for the others). */
export function stackMax(kind: number, item: number): number {
  if (kind === ITEM_HEAL) return HEAL_ITEMS[item]?.stack ?? 0;
  if (kind === ITEM_SHIELD) return ROYALE.shieldStack;
  return 0;
}

/**
 * Walking over a stack of `amount` (healing items, shield charges) with
 * `have` of them: taken up to `max`, the rest stays on the floor. `taken` 0:
 * nothing happens (already at the maximum).
 */
export function takeStack(have: number, max: number, amount: number): { have: number; left: number; taken: number } {
  const taken = Math.max(0, Math.min(max - have, amount));
  return { have: have + taken, left: amount - taken, taken };
}

/** What a kit carries of a stack kind (ITEM_HEAL with its item, ITEM_SHIELD). */
export function carriedStack(kit: KitSim, kind: number, item: number): number {
  return kind === ITEM_HEAL ? healsOf(kit, item) : kind === ITEM_SHIELD ? kit.shields : 0;
}

/** Sets what a kit carries of a stack kind, in place. */
export function setCarriedStack(kit: KitSim, kind: number, item: number, n: number) {
  if (kind === ITEM_HEAL) setHeals(kit, item, n);
  else if (kind === ITEM_SHIELD) kit.shields = n;
}

/** The healing items and shield charges a kit carries, as floor stacks (what a knock-out drops). */
export function carriedStacks(kit: KitSim): ItemDrop[] {
  const out: ItemDrop[] = [];
  if (kit.bandages > 0) out.push({ kind: ITEM_HEAL, item: HEAL_BANDAGE, amount: kit.bandages });
  if (kit.medkits > 0) out.push({ kind: ITEM_HEAL, item: HEAL_MEDKIT, amount: kit.medkits });
  if (kit.shields > 0) out.push({ kind: ITEM_SHIELD, item: 0, amount: kit.shields });
  return out;
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

/** The floor item a loot line gives (a gun with a full magazine, a stack of grenades, healing items or shield charges). */
export function lootItem(e: LootEntry): ItemDrop {
  if (e.kind === "gun") {
    const id = WEAPONS.findIndex((w) => w.key === e.key);
    return { kind: ITEM_GUN, item: id, amount: WEAPONS[id].magazine };
  }
  if (e.kind === "grenade") return { kind: ITEM_GRENADE, item: GRENADES.findIndex((g) => g.key === e.key), amount: e.amount };
  if (e.kind === "heal") return { kind: ITEM_HEAL, item: HEAL_ITEMS.findIndex((h) => h.key === e.key), amount: e.amount };
  return { kind: ITEM_SHIELD, item: 0, amount: e.amount };
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
