// A small royale world with only bots in it, for the bots' own tests and
// benchmark (sim.test.ts, bench/bots.bench.ts): no server, no network. Each
// tick, like GameRoom.tick: every bot's view, its brain about once a second
// (staggered), its control input, the real `stepPlayer` in slots mode; then
// a minimal floor (F opens chests and swaps guns, walking over items takes
// them, with the shared royale rules), the zone's damage and the pose ring
// for the lag-compensated aim. No bullets: nobody is hurt but by the zone.
//
// Not exported from the package: it's a test tool, the server has its own world.

import { GRENADE_FRAG, HIT_REWIND_TICKS, ITEM_GUN, ITEM_HEAL, ITEM_PERK, ITEM_SHIELD, NO_TEAM, PISTOL, ROYALE, SHIELD_TICKS, ticks } from "../constants.ts";
import { readSim, spawnSim, stepPlayer, writeSim } from "../combat.ts";
import type { MapDef } from "../maps/types.ts";
import type { Vec2 } from "../physics.ts";
import type { CrateView, FloorItemView, InputMessage, ZoneView } from "../protocol.ts";
import { NO_GUN, carriedStack, fTarget, gunInHand, itemReady, lootSpot, outsideZone, rollLoot, setCarriedStack, stackMax, startKit, swapGun, takeGun, takeStack, walkTakesPerk, zoneDamage } from "../royale.ts";
import { ruleBrain, type BotBrain, type Goal } from "./brain.ts";
import { botInput, createBotState, type BotState } from "./control.ts";
import { navGrid, type NavGrid } from "./grid.ts";
import { createRng, rngNext, type BotRng } from "./rng.ts";
import { BOT_TUNING } from "./tuning.ts";
import { buildBotView, type BotPlayerInput, type BotWorld } from "./view.ts";

export interface SimBot {
  id: string;
  state: BotState;
  rng: BotRng;
  goal: Goal;
  /** The tick of its next decision. */
  nextDecide: number;
}

export interface BotSim {
  world: BotWorld & { players: Map<string, BotPlayerInput>; items: Map<string, FloorItemView>; crates: Map<string, CrateView> };
  grid: NavGrid;
  bots: SimBot[];
  brain: BotBrain;
  /** The floor's own draws (loot). */
  rng: BotRng;
  nextId: number;
  /** Poses by tick, HIT_REWIND_TICKS + 1 kept. */
  poses: Map<number, Map<string, Vec2>>;
}

/** Time spent per part of a tick, in whatever unit `now` returns (bench only). */
export interface SimTiming {
  now: () => number;
  view: number;
  brain: number;
  control: number;
  step: number;
  /** Ticks on which a bot planned a path. */
  replans: number;
}

/** A zone that never closes on anyone (centred, huge): for runs about moving, not the zone. */
export function wideZone(map: MapDef): ZoneView {
  const r = Math.hypot(map.halfX, map.halfZ) + 2;
  return { x0: 0, z0: 0, x1: 0, z1: 0, r0: r, r1: r, start: 0, end: 1 };
}

/**
 * A world on `map` with `count` bots, on the map's spawns (or `starts`), a
 * closed chest on every crate spot, and `zone` (wideZone by default).
 */
export function createBotSim(opts: { map: MapDef; count: number; seed: number; zone?: ZoneView; starts?: readonly Vec2[]; brain?: BotBrain }): BotSim {
  const { map, count, seed } = opts;
  const starts = opts.starts ?? map.spawns;
  const players = new Map<string, BotPlayerInput>();
  const bots: SimBot[] = [];
  for (let i = 0; i < count; i++) {
    const id = `bot:${i}`;
    const s = starts[i % starts.length];
    const sim = spawnSim(s.x, s.z, PISTOL, undefined, startKit());
    players.set(id, { ...sim, alive: true, team: NO_TEAM, weapon: PISTOL, shieldTicks: 0 });
    // Staggered decisions: one bot per tick or so, never all on one.
    bots.push({ id, state: createBotState(id), rng: createRng(seed * 7919 + i), goal: { kind: "roam" }, nextDecide: 1 + (i % ticks(BOT_TUNING.decideEvery)) });
  }
  const crates = new Map<string, CrateView>();
  let nextId = 0;
  for (const c of map.royale?.crates ?? []) crates.set(String(nextId++), { x: c.x, z: c.z, open: false });
  return {
    world: { map, tick: 0, phase: "playing", zone: opts.zone ?? wideZone(map), players, rewound: null, items: new Map(), crates },
    grid: navGrid(map),
    bots,
    brain: opts.brain ?? ruleBrain,
    rng: createRng(seed ^ 0x5bd1e995),
    nextId,
    poses: new Map(),
  };
}

/** One tick of the world. Returns every bot's input, in bot order. */
export function stepBotSim(sim: BotSim, timing?: SimTiming): InputMessage[] {
  const w = sim.world;
  w.tick++;
  const tick = w.tick;
  w.rewound = sim.poses.get(tick - HIT_REWIND_TICKS) ?? null;
  const inputs: InputMessage[] = [];
  const now = timing?.now;

  for (const bot of sim.bots) {
    const p = w.players.get(bot.id)!;
    let t0 = now ? now() : 0;
    const view = buildBotView(w, bot.id)!;
    if (timing && now) {
      const t = now();
      timing.view += t - t0;
      t0 = t;
    }
    if (tick >= bot.nextDecide) {
      bot.nextDecide = tick + ticks(BOT_TUNING.decideEvery);
      const g = sim.brain.decide(view);
      if (g instanceof Promise) throw new Error("the harness runs synchronous brains only");
      bot.goal = g;
    }
    if (timing && now) {
      const t = now();
      timing.brain += t - t0;
      t0 = t;
    }
    const planned = bot.state.planTick;
    const input = botInput(bot.state, bot.goal, view, sim.grid, bot.rng);
    if (timing && now) {
      const t = now();
      timing.control += t - t0;
      t0 = t;
      if (bot.state.planTick !== planned) timing.replans++;
    }
    inputs.push(input);

    const res = stepPlayer(w.map, readSim(p), input, p.weapon, { act: p.alive, armed: p.alive }, GRENADE_FRAG, "slots");
    writeSim(p, res.sim);
    const hand = gunInHand(p.kit);
    if (hand !== NO_GUN) p.weapon = hand;
    if (p.shieldTicks > 0) p.shieldTicks--;
    if (res.shield) p.shieldTicks = SHIELD_TICKS;
    if (res.swap && p.alive) interact(sim, bot.id, p);
    if (timing && now) timing.step += now() - t0;
  }

  pickups(sim);

  // The zone, then the poses of this tick.
  w.players.forEach((p) => {
    if (!p.alive || !outsideZone(w.zone, tick, p.x, p.z)) return;
    p.hp = Math.max(0, p.hp - zoneDamage(w.zone, tick));
    if (p.hp === 0) p.alive = false;
  });
  const frame = new Map<string, Vec2>();
  w.players.forEach((p, id) => frame.set(id, { x: p.x, z: p.z }));
  sim.poses.set(tick, frame);
  sim.poses.delete(tick - HIT_REWIND_TICKS - 1);
  return inputs;
}

function drop(sim: BotSim, item: Omit<FloorItemView, "blockedFor" | "fromX" | "fromZ" | "dropTick" | "readyTick">, extra: Partial<FloorItemView> = {}) {
  sim.world.items.set(String(sim.nextId++), { blockedFor: "", fromX: 0, fromZ: 0, dropTick: 0, readyTick: 0, ...item, ...extra });
}

/** F, like floor.ts' interact: a chest opens (its loot pops out next to it), or the gun in hand swaps. */
function interact(sim: BotSim, id: string, p: BotPlayerInput) {
  const w = sim.world;
  const pick = fTarget(p.kit, { type: GRENADE_FRAG, count: p.kit.grenades }, p.x, p.z, w.items, w.crates, id, w.tick, p.perk);
  if (!pick) return;
  if (pick.kind === "chest") {
    const c = w.crates.get(pick.id)!;
    c.open = true;
    const loot = rollLoot(rngNext(sim.rng));
    const avoid = [...w.crates.values()].map((o) => ({ x: o.x, z: o.z, r: ROYALE.crateRadius + 0.3 }));
    const at = lootSpot(w.map, c.x, c.z, Math.atan2(p.z - c.z, p.x - c.x), avoid);
    drop(sim, { x: at.x, z: at.z, ...loot }, { fromX: c.x, fromZ: c.z, dropTick: w.tick, readyTick: w.tick + ticks(ROYALE.lootDrop) });
    return;
  }
  if (pick.kind === "gun") {
    const r = swapGun(readSim(p), pick.item.item, pick.item.amount);
    if (!r) return;
    writeSim(p, r.sim);
    w.items.delete(pick.id);
    drop(sim, { x: p.x, z: p.z, kind: ITEM_GUN, item: r.dropped.weapon, amount: r.dropped.mag }, { blockedFor: id });
  }
}

/** Walking over items, like floor.ts' step (nearest bot first; a dropper steps off before taking it back). */
function pickups(sim: BotSim) {
  const w = sim.world;
  w.items.forEach((it) => {
    if (!it.blockedFor) return;
    const q = w.players.get(it.blockedFor);
    if (!q || Math.hypot(q.x - it.x, q.z - it.z) > ROYALE.pickupRadius) it.blockedFor = "";
  });
  for (const [iid, it] of Array.from(w.items.entries())) {
    if (!itemReady(it, w.tick)) continue;
    const near = Array.from(w.players.entries())
      .filter(([pid, p]) => p.alive && it.blockedFor !== pid && Math.hypot(p.x - it.x, p.z - it.z) <= ROYALE.pickupRadius)
      .sort((a, b) => Math.hypot(a[1].x - it.x, a[1].z - it.z) - Math.hypot(b[1].x - it.x, b[1].z - it.z));
    for (const [, p] of near) {
      if (it.kind === ITEM_GUN) {
        const next = takeGun(readSim(p), it.item, it.amount);
        if (!next) continue;
        writeSim(p, next);
        w.items.delete(iid);
        break;
      }
      if (it.kind === ITEM_PERK) {
        if (!walkTakesPerk(p.perk)) continue;
        p.perk = it.item;
        w.items.delete(iid);
        break;
      }
      if (it.kind === ITEM_HEAL || it.kind === ITEM_SHIELD) {
        const r = takeStack(carriedStack(p.kit, it.kind, it.item), stackMax(it.kind, it.item), it.amount);
        if (r.taken === 0) continue;
        setCarriedStack(p.kit, it.kind, it.item, r.have);
        if (r.left > 0) it.amount = r.left;
        else w.items.delete(iid);
        break;
      }
    }
  }
}
