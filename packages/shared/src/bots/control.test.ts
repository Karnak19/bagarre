// Tests of the control layer (control.ts): a heal is never cancelled by the
// bot's own shot (nor F, a switch or a strike), the reaction delay, the aim
// at the lag-compensated pose, and press counters that only go up, by one.
// Run with `bun run test` (or `bun test src/bots` in packages/shared).

import { describe, expect, test } from "bun:test";
import { readSim, spawnSim, stepPlayer, writeSim } from "../combat.ts";
import { GRENADE_FRAG, HEAL_BANDAGE, HEAL_ITEMS, NO_HEAL, NO_TEAM, PISTOL, WEAPONS, ticks } from "../constants.ts";
import { ROYALE_MAPS } from "../maps/index.ts";
import { YARD } from "../maps/yard.ts";
import type { MapDef } from "../maps/types.ts";
import type { InputMessage, KitSim, ZoneView } from "../protocol.ts";
import { HEAL_STOP, startKit } from "../royale.ts";
import type { Goal } from "./brain.ts";
import { botInput, createBotState, type BotPresses } from "./control.ts";
import { buildNavGrid } from "./grid.ts";
import { createBotSim, stepBotSim } from "./harness.ts";
import { createRng } from "./rng.ts";
import { BOT_TUNING } from "./tuning.ts";
import { buildBotView, type BotPlayerInput, type BotWorld } from "./view.ts";

const RIFLE = WEAPONS.findIndex((w) => w.key === "rifle");
const MAP: MapDef = { ...YARD, id: "bots-control-test", halfX: 30, halfZ: 30, obstacles: [] };
const NO_ZONE: ZoneView = { x0: 0, z0: 0, x1: 0, z1: 0, r0: 0, r1: 0, start: 0, end: 0 };
const grid = buildNavGrid(MAP.id, MAP);

function player(x: number, z: number, hp = 100, kit: Partial<KitSim> = {}): BotPlayerInput {
  return { ...spawnSim(x, z, PISTOL, undefined, { ...startKit(), ...kit }), hp, alive: true, team: NO_TEAM, weapon: PISTOL, shieldTicks: 0 };
}

function world(players: Record<string, BotPlayerInput>, tick = 100): BotWorld {
  return { map: MAP, tick, phase: "playing", zone: NO_ZONE, players: new Map(Object.entries(players)), rewound: null, items: new Map(), crates: new Map() };
}

const cancelKeys: (keyof BotPresses)[] = ["swap", "switch", "melee"];
const pressOf = (i: InputMessage, k: keyof BotPresses) => (i[k] ?? 0) as number;

describe("healing", () => {
  test("while a heal runs: no shot, no F, no switch, no strike, even with an enemy in reach and a fight goal", () => {
    const state = createBotState("me");
    const rng = createRng(1);
    // Healing, a better gun in another slot (it would want to switch), an enemy at melee range with a clear shot.
    const me = player(0, 0, 40, { heal: HEAL_BANDAGE, healTicks: 40, bandages: 1, gun1: RIFLE, mag1: 12 });
    const goal: Goal = { kind: "fight", target: "them" };
    for (let t = 0; t < 60; t++) {
      const w = world({ me, them: player(1.2, 0) }, 100 + t);
      const input = botInput(state, goal, buildBotView(w, "me")!, grid, rng);
      expect(input.fire).toBe(false);
      for (const k of cancelKeys) expect(pressOf(input, k)).toBe(0);
    }
  });

  test("the tick a heal starts: `use` up by one with the item, the trigger up", () => {
    const state = createBotState("me");
    const input = botInput(state, { kind: "heal" }, buildBotView(world({ me: player(0, 0, 40, { bandages: 1 }) }), "me")!, grid, createRng(1));
    expect(input.use).toBe(1);
    expect(input.heal).toBe(HEAL_BANDAGE);
    expect(input.fire).toBe(false);
  });

  test("through the real step: a heal started, then an enemy shows up and the goal turns to fight: the heal still completes", () => {
    const state = createBotState("me");
    const rng = createRng(3);
    const me = player(0, 0, 40, { bandages: 1 });
    let healed = false;
    for (let t = 0; t < ticks(HEAL_ITEMS[HEAL_BANDAGE].duration) + 10; t++) {
      const players: Record<string, BotPlayerInput> = { me };
      // From the 3rd tick on, an enemy in the open in front of the bot.
      if (t >= 2) players.them = player(6, 0);
      const goal: Goal = t >= 2 ? { kind: "fight", target: "them" } : { kind: "heal" };
      const input = botInput(state, goal, buildBotView(world(players, 100 + t), "me")!, grid, rng);
      const res = stepPlayer(MAP, readSim(me), input, me.weapon, true, GRENADE_FRAG, "slots");
      expect(res.fired && me.kit.heal !== NO_HEAL).toBe(false);
      writeSim(me, res.sim);
      expect(me.kit.healStop).not.toBe(HEAL_STOP.fire);
      if (res.healed > 0) healed = true;
    }
    expect(healed).toBe(true);
    expect(me.hp).toBe(40 + HEAL_ITEMS[HEAL_BANDAGE].amount);
    expect(me.kit.bandages).toBe(0);
  });
});

describe("fighting", () => {
  test("no shot before the reaction delay at a target newly in sight, then it fires", () => {
    const state = createBotState("me");
    const rng = createRng(5);
    const goal: Goal = { kind: "fight", target: "them" };
    const fired: boolean[] = [];
    for (let t = 0; t < ticks(BOT_TUNING.reaction) + 5; t++) {
      fired.push(botInput(state, goal, buildBotView(world({ me: player(0, 0), them: player(8, 0) }, 100 + t), "me")!, grid, rng).fire);
    }
    expect(fired.slice(0, ticks(BOT_TUNING.reaction))).not.toContain(true);
    expect(fired[fired.length - 1]).toBe(true);
  });

  test("aims at the pose from HIT_REWIND_TICKS ago, within the aim spread", () => {
    const state = createBotState("me");
    const rng = createRng(9);
    for (let t = 0; t < 30; t++) {
      const w = { ...world({ me: player(0, 0), them: player(8, 4) }, 100 + t), rewound: new Map([["them", { x: 8, z: -4 }]]) };
      const input = botInput(state, { kind: "fight", target: "them" }, buildBotView(w, "me")!, grid, rng);
      const want = Math.atan2(-4, 8);
      expect(Math.abs(input.aim - want)).toBeLessThanOrEqual(BOT_TUNING.aimSpread + 1e-9);
    }
  });
});

describe("press counters", () => {
  test("seq +1 per input; every counter only goes up, by at most one per input (9 bots, 30 s on a royale map)", () => {
    const sim = createBotSim({ map: ROYALE_MAPS[0], count: 9, seed: 11 });
    const keys = ["dash", "grenade", "shield", "reload", "switch", "swap", "use", "melee"] as const;
    let prev: InputMessage[] | null = null;
    const ups = new Map<string, number>();
    for (let t = 0; t < 900; t++) {
      const inputs = stepBotSim(sim);
      if (prev) {
        inputs.forEach((cur, i) => {
          expect(cur.seq).toBe(prev![i].seq + 1);
          for (const k of keys) {
            const d = (cur[k] ?? 0) - (prev![i][k] ?? 0);
            expect(d === 0 || d === 1).toBe(true);
            if (d) ups.set(k, (ups.get(k) ?? 0) + 1);
          }
        });
      }
      prev = inputs;
    }
    // They do loot: F was pressed, guns switched.
    expect(ups.get("swap") ?? 0).toBeGreaterThan(0);
    expect(ups.get("switch") ?? 0).toBeGreaterThan(0);
  });
});

describe("stuck", () => {
  test("a path that runs into a wall: no progress for BOT_TUNING.stuckTime, a sidestep and a fresh path get it there", () => {
    const walled: MapDef = { ...MAP, id: "bots-stuck-test", obstacles: [{ kind: "wall", x: 0, z: -5, w: 1, d: 30, h: 1.3 }] };
    const g = buildNavGrid(walled.id, walled);
    const state = createBotState("me");
    const rng = createRng(2);
    const me = player(-4, 0);
    const dest = { x: 4, z: 0 };
    // A stale path straight through the wall, just planned (so the cap holds a normal replan off).
    state.path = [dest];
    state.pathDest = dest;
    state.planTick = 100;
    state.roam = dest;
    state.roamUntil = 1_000_000;
    let replanned = -1;
    let t = 0;
    for (; t < 30 * 20 && Math.hypot(me.x - dest.x, me.z - dest.z) > BOT_TUNING.roamReach; t++) {
      const w = { ...world({ me }, 100 + t), map: walled };
      const input = botInput(state, { kind: "roam" }, buildBotView(w, "me")!, g, rng);
      if (replanned < 0 && state.planTick > 100) replanned = t;
      writeSim(me, stepPlayer(walled, readSim(me), input, me.weapon, true, GRENADE_FRAG, "slots").sim);
    }
    expect(replanned).toBeGreaterThan(0);
    expect(replanned).toBeLessThanOrEqual(ticks(BOT_TUNING.stuckTime) + 15);
    expect(Math.hypot(me.x - dest.x, me.z - dest.z)).toBeLessThanOrEqual(BOT_TUNING.roamReach);
  });
});
