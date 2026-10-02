// What one bot sees (`BotView`): plain data, built each tick by a pure
// function (`buildBotView`) from the shapes the server already has, the same
// for the rule brain, the control layer and a prompt. Only ids and numbers,
// never a player's name: names are chosen by users, and nothing a user typed
// may reach a bot's decision (or the Jev prompt built from this).
//
// The server fills in a `BotWorld` (its state, plus the poses it keeps for
// lag compensation). Enemies are listed only when a player would see them:
// within BOT_TUNING.sightRange and with a body in sight (`bodiesSee`). Each
// one carries its pose from HIT_REWIND_TICKS ago too, what the server's hit
// test judges a shot against, so the bot aims there.

import type { Arena, Box } from "../arena.ts";
import { BULLET_RADIUS, HEAL_BANDAGE, HEAL_ITEMS, HEAL_MEDKIT, ITEM_GUN, ITEM_HEAL, ITEM_PERK, ITEM_SHIELD, NO_HEAL, NO_PERK, PISTOL, PLAYER_RADIUS, ROYALE, TICK_RATE } from "../constants.ts";
import { readSim, sameTeam, weaponDef } from "../combat.ts";
import type { MapDef } from "../maps/types.ts";
import { magazineOf } from "../perks.ts";
import { clearShot, bodiesSee } from "../sight.ts";
import type { Vec2 } from "../physics.ts";
import type { CrateView, FloorItemView, MapLike, PlayerSim, ZoneView } from "../protocol.ts";
import { NO_GUN, canStartHeal, carriedGuns, carriesGun, freeGunSlot, gunInHand, healsOf, healing, itemReady, outsideZone, swapTarget, zoneAt, zoneDps } from "../royale.ts";
import { BOT_TUNING } from "./tuning.ts";

/**
 * A player as the server holds it (the `Player` schema fits): the sim, plus
 * what a bot reads of the others. Nothing here is a name.
 */
export interface BotPlayerInput extends PlayerSim {
  alive: boolean;
  /** NO_TEAM outside a team mode (the royale). */
  team: number;
  /** The gun in hand (a WEAPONS index). */
  weapon: number;
  /** Shield bubble ticks left (0: none up). */
  shieldTicks: number;
}

/**
 * Everything `buildBotView` reads: the server's room state, plus the poses it
 * records for lag compensation. Plain shapes: a Colyseus MapSchema and a Map
 * are both MapLike.
 */
export interface BotWorld {
  /** The room's map. */
  map: MapDef;
  /** The server tick (state.tick). */
  tick: number;
  /** Shots, heals and F only count while "playing" (playerCan's `armed`, F's royale rule). */
  phase: string;
  zone: ZoneView;
  players: MapLike<BotPlayerInput>;
  /**
   * Every player's pose HIT_REWIND_TICKS ago, by session id: the frame
   * `GameRoom.historyAt(tick - HIT_REWIND_TICKS)` holds. A player missing
   * from it (or null: no frame yet) is aimed at where they stand now.
   */
  rewound: MapLike<Vec2> | null;
  items: MapLike<FloorItemView>;
  crates: MapLike<CrateView>;
}

export interface BotEnemy {
  id: string;
  x: number;
  z: number;
  /** Where the hit test will judge a shot fired now: the pose HIT_REWIND_TICKS ago. */
  aimX: number;
  aimZ: number;
  dist: number;
  hp: number;
  /** The gun in their hand. */
  weapon: number;
  /** A shield bubble is up. */
  shielded: boolean;
  /** A bullet from the bot's centre reaches the aim point (`clearShot`). */
  shot: boolean;
}

export interface BotChest {
  id: string;
  x: number;
  z: number;
  dist: number;
}

export interface BotItem {
  id: string;
  x: number;
  z: number;
  dist: number;
  /** An ITEM_KINDS index, which one, how many (FloorItemView). */
  kind: number;
  item: number;
  amount: number;
  /** It has landed (a chest's loot falls for a moment first). */
  ready: boolean;
  /** Walking over it takes it (gun into a free slot, a stack not full, a perk with none held). False: F only (a gun swap). */
  walk: boolean;
}

export interface BotZone {
  /** The circle now. */
  x: number;
  z: number;
  r: number;
  /** Where it closes (the flow field's target, flow.ts). */
  tx: number;
  tz: number;
  tr: number;
  /** Outside now, and outside BOT_TUNING.zoneLookahead seconds from now (or this close to the edge while it shrinks). */
  outside: boolean;
  soon: boolean;
  /** Metres to the edge: positive inside, negative outside. */
  edge: number;
  /** Damage per second outside right now. */
  dps: number;
  shrinking: boolean;
}

export interface BotSelf {
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  /** The step's own copy of the bot (`readSim`), for the control layer's cooldown checks. */
  sim: PlayerSim;
  /** The gun in hand, its magazine now and full, and a reload in progress. */
  weapon: number;
  ammo: number;
  magazine: number;
  reloading: boolean;
  guns: { slot: number; weapon: number; mag: number }[];
  /** A gun slot is free (walking over a gun takes it). */
  freeSlot: boolean;
  /** Only the Pistol: the "weak kit" of the decision table. */
  pistolOnly: boolean;
  bandages: number;
  medkits: number;
  shields: number;
  perk: number;
  /** A heal in progress. */
  healing: boolean;
  /** The healing item a heal would start with now (HEAL_BANDAGE or HEAL_MEDKIT), NO_HEAL: none can start. */
  heal: number;
  /** Shield bubble up. */
  shielded: boolean;
}

export interface BotView {
  id: string;
  tick: number;
  /** Shots, heals and F count ("playing"). */
  armed: boolean;
  self: BotSelf;
  /** Null: no zone. */
  zone: BotZone | null;
  /** Enemies in sight, nearest first. */
  enemies: BotEnemy[];
  /** Closed chests within BOT_TUNING.lootRange, nearest first, at most BOT_TUNING.maxListed. */
  chests: BotChest[];
  /** Floor items the bot wants, same limits. */
  items: BotItem[];
  /**
   * What F would swap the gun in hand for, when that's a better gun
   * (`swapTarget`, all slots full, `gunScore` higher): its item id. Null: none.
   */
  swap: { id: string; weapon: number } | null;
}

/**
 * How much a bot wants a gun: damage per second times a bonus for range.
 * Every loot gun scores above the Pistol.
 */
export function gunScore(weapon: number): number {
  if (weapon === NO_GUN) return 0;
  const w = weaponDef(weapon);
  const dps = (w.damage * w.pellets * (w.burst ?? 1)) / w.fireInterval;
  return dps * (1 + w.range / 30);
}

/** The heal a bot would start now: a medkit when low (or nothing else), else a bandage. NO_HEAL: none can start. */
export function bestHeal(sim: PlayerSim): number {
  const order = sim.hp < BOT_TUNING.medkitBelow ? [HEAL_MEDKIT, HEAL_BANDAGE] : [HEAL_BANDAGE, HEAL_MEDKIT];
  for (const h of order) if (canStartHeal(sim, h)) return h;
  return NO_HEAL;
}

/**
 * Whether bot `id` (`sim`) wants a floor item, and how it would take it.
 * Grenades are never wanted (bots don't throw, #48's scope).
 */
function wantItem(sim: PlayerSim, id: string, it: FloorItemView): { walk: boolean } | null {
  if (it.blockedFor === id) return null;
  if (it.kind === ITEM_GUN) {
    if (carriesGun(sim.kit, it.item)) return null;
    if (freeGunSlot(sim.kit) !== -1) return { walk: true };
    return gunScore(it.item) > gunScore(gunInHand(sim.kit)) ? { walk: false } : null;
  }
  if (it.kind === ITEM_HEAL) return healsOf(sim.kit, it.item) < (HEAL_ITEMS[it.item]?.stack ?? 0) ? { walk: true } : null;
  if (it.kind === ITEM_SHIELD) return sim.kit.shields < ROYALE.shieldStack ? { walk: true } : null;
  if (it.kind === ITEM_PERK) return sim.perk === NO_PERK ? { walk: true } : null;
  return null;
}

/**
 * `bodiesSee` (sight.ts) with the boxes nowhere near the two bodies skipped
 * first: the same answer, much cheaper on a big map (most boxes are far).
 */
export function botSees(arena: Arena, a: Vec2, b: Vec2): boolean {
  const r = PLAYER_RADIUS + BULLET_RADIUS;
  const minX = Math.min(a.x, b.x) - r;
  const maxX = Math.max(a.x, b.x) + r;
  const minZ = Math.min(a.z, b.z) - r;
  const maxZ = Math.max(a.z, b.z) + r;
  const near: Box[] = [];
  for (const o of arena.obstacles) {
    if (o.x + o.w / 2 < minX || o.x - o.w / 2 > maxX || o.z + o.d / 2 < minZ || o.z - o.d / 2 > maxZ) continue;
    near.push(o);
  }
  return near.length === 0 || bodiesSee({ halfX: arena.halfX, halfZ: arena.halfZ, obstacles: near }, a, b);
}

/** By distance, then id: a stable order. */
const byDist = <T extends { dist: number; id: string }>(a: T, b: T) => a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The view of bot `id`, or null when it isn't in `world.players`. Pure. */
export function buildBotView(world: BotWorld, id: string): BotView | null {
  const me = world.players.get(id);
  if (!me) return null;
  const sim = readSim(me);
  const tick = world.tick;
  const arena = world.map;
  const hand = gunInHand(sim.kit);
  const weapon = hand !== NO_GUN ? hand : me.weapon;
  const guns = carriedGuns(sim);
  const pos: Vec2 = { x: me.x, z: me.z };

  const self: BotSelf = {
    x: me.x,
    z: me.z,
    hp: me.hp,
    alive: me.alive,
    sim,
    weapon,
    ammo: sim.ammo,
    magazine: magazineOf(weaponDef(weapon), sim.perk),
    reloading: sim.reloadTicks > 0,
    guns,
    freeSlot: freeGunSlot(sim.kit) !== -1,
    pistolOnly: guns.every((g) => g.weapon === PISTOL),
    bandages: sim.kit.bandages,
    medkits: sim.kit.medkits,
    shields: sim.kit.shields,
    perk: sim.perk,
    healing: healing(sim.kit),
    heal: bestHeal(sim),
    shielded: me.shieldTicks > 0,
  };

  let zone: BotZone | null = null;
  const c = zoneAt(world.zone, tick);
  if (c) {
    const d = Math.hypot(me.x - c.x, me.z - c.z);
    const shrinking = tick >= world.zone.start && tick < world.zone.end;
    const outside = outsideZone(world.zone, tick, me.x, me.z);
    const later = outsideZone(world.zone, tick + BOT_TUNING.zoneLookahead * TICK_RATE, me.x, me.z);
    zone = {
      x: c.x,
      z: c.z,
      r: c.r,
      tx: world.zone.x1,
      tz: world.zone.z1,
      tr: world.zone.r1,
      outside,
      soon: !outside && (later || (shrinking && c.r - d < BOT_TUNING.zoneEdgeMargin)),
      edge: c.r - d,
      dps: zoneDps(world.zone, tick),
      shrinking,
    };
  }

  const enemies: BotEnemy[] = [];
  const range2 = BOT_TUNING.sightRange * BOT_TUNING.sightRange;
  world.players.forEach((p, pid) => {
    if (pid === id || !p.alive || sameTeam(me.team, p.team)) return;
    const d2 = (p.x - me.x) ** 2 + (p.z - me.z) ** 2;
    if (d2 > range2) return;
    if (!botSees(arena, pos, p)) return;
    const past = world.rewound?.get(pid);
    const aim = past ?? { x: p.x, z: p.z };
    enemies.push({
      id: pid,
      x: p.x,
      z: p.z,
      aimX: aim.x,
      aimZ: aim.z,
      dist: Math.sqrt(d2),
      hp: p.hp,
      weapon: p.weapon,
      shielded: p.shieldTicks > 0,
      shot: clearShot(arena, pos, aim),
    });
  });
  enemies.sort(byDist);

  const lootR = BOT_TUNING.lootRange;
  const chests: BotChest[] = [];
  world.crates.forEach((cr, cid) => {
    if (cr.open) return;
    const dist = Math.hypot(cr.x - me.x, cr.z - me.z);
    if (dist <= lootR) chests.push({ id: cid, x: cr.x, z: cr.z, dist });
  });
  chests.sort(byDist);
  chests.length = Math.min(chests.length, BOT_TUNING.maxListed);

  const items: BotItem[] = [];
  world.items.forEach((it, iid) => {
    const dist = Math.hypot(it.x - me.x, it.z - me.z);
    if (dist > lootR) return;
    const want = wantItem(sim, id, it);
    if (!want) return;
    items.push({ id: iid, x: it.x, z: it.z, dist, kind: it.kind, item: it.item, amount: it.amount, ready: itemReady(it, tick), walk: want.walk });
  });
  items.sort(byDist);
  items.length = Math.min(items.length, BOT_TUNING.maxListed);

  let swap: BotView["swap"] = null;
  if (freeGunSlot(sim.kit) === -1) {
    const t = swapTarget(sim.kit, me.x, me.z, world.items, id, tick);
    if (t && gunScore(t.item.item) > gunScore(hand)) swap = { id: t.id, weapon: t.item.item };
  }

  return { id, tick, armed: world.phase === "playing", self, zone, enemies, chests, items, swap };
}
