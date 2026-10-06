// Tests of the bots' driver (bots.ts) with fake brains: whatever the brain
// does (never answers, rejects, throws, answers garbage or a target that is
// gone), every bot gets an input every tick, synchronously, and keeps
// playing; the decision counts and the cap on decisions in flight hold.
// The world is a real GameState (state.ts) on Ironvale, stepped with the
// shared `stepPlayer` like GameRoom does, with no room around it; the other
// modes' bots (no zone, no chests, the loadout kit, teams, respawns) on an
// FFA map the same way.
// Run with `bun run test` (or `bun test src/bots.test.ts` in apps/server).

import { describe, expect, test } from "bun:test";
import { DEFAULT_WEAPON, GRENADE_FRAG, HIT_REWIND_TICKS, NO_TEAM, PISTOL, TEAM_BLUE, TEAM_RED, mapById, readSim, ruleBrain, spawnSim, startKit, stepPlayer, writeSim, type BotBrain, type BotView, type BotWorld, type Goal, type InputMessage } from "@bagarre/shared";
import { BOT_DECISION_TIMEOUT, BOT_MAX_IN_FLIGHT, BotDriver, saneGoal } from "./bots.ts";
import { GameState, Player } from "./state.ts";

const MAP = mapById("ironvale");

/** A room with `count` bots on Ironvale's spawns, playing, under a zone that never closes on anyone. */
function room(count: number) {
  const state = new GameState();
  state.phase = "playing";
  const r = Math.hypot(MAP.halfX, MAP.halfZ) + 2;
  Object.assign(state.zone, { x0: 0, z0: 0, x1: 0, z1: 0, r0: r, r1: r, start: 1, end: 1_000_000 });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `bot:${i + 1}`;
    const s = MAP.spawns[i % MAP.spawns.length];
    const p = new Player();
    p.weapon = PISTOL;
    writeSim(p, spawnSim(s.x, s.z, PISTOL, undefined, startKit()));
    state.players.set(id, p);
    ids.push(id);
  }
  /** Poses by tick, for `rewound`. */
  const poses = new Map<number, Map<string, { x: number; z: number }>>();
  const world = (): BotWorld => ({
    map: MAP,
    tick: state.tick,
    phase: state.phase,
    zone: state.zone,
    players: state.players,
    rewound: poses.get(state.tick - HIT_REWIND_TICKS) ?? null,
    items: state.items,
    crates: state.crates,
  });
  /** One tick: every bot's input (checked to be one, never a Promise), then the step, then this tick's poses. */
  const step = (driver: BotDriver): InputMessage[] => {
    state.tick++;
    const w = world();
    const inputs: InputMessage[] = [];
    for (const id of ids) {
      const input = driver.input(w, id);
      expect(input).not.toBeNull();
      expect(input instanceof Promise).toBe(false);
      inputs.push(input!);
      const p = state.players.get(id)!;
      const res = stepPlayer(MAP, readSim(p), input!, p.weapon, { act: p.alive, armed: p.alive }, GRENADE_FRAG, "slots");
      writeSim(p, res.sim);
    }
    const frame = new Map<string, { x: number; z: number }>();
    state.players.forEach((p, id) => frame.set(id, { x: p.x, z: p.z }));
    poses.set(state.tick, frame);
    poses.delete(state.tick - HIT_REWIND_TICKS - 1);
    return inputs;
  };
  const positions = () => ids.map((id) => ({ x: state.players.get(id)!.x, z: state.players.get(id)!.z }));
  return { state, ids, step, positions, world };
}

/** Let promise callbacks run (resolved answers come in between two ticks, as on the server). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** How many bots moved more than 2 m from where they started. */
function moved(before: { x: number; z: number }[], after: { x: number; z: number }[]): number {
  return before.filter((b, i) => Math.hypot(after[i].x - b.x, after[i].z - b.z) > 2).length;
}

/** Runs `n` ticks, flushing promises between them; checks the cap on every tick. */
async function run(r: ReturnType<typeof room>, driver: BotDriver, n: number) {
  for (let i = 0; i < n; i++) {
    r.step(driver);
    expect(driver.pending).toBeLessThanOrEqual(BOT_MAX_IN_FLIGHT);
    await flush();
  }
}

describe("BotDriver", () => {
  test("rule brain: 9 bots get an input each tick, with the seq going up by one, and move off their spawns", () => {
    const r = room(9);
    const driver = new BotDriver({ brain: ruleBrain });
    const start = r.positions();
    const seqs = new Map<string, number>();
    for (let t = 0; t < 300; t++) {
      r.step(driver).forEach((input, i) => {
        const id = r.ids[i];
        expect(input.seq).toBe((seqs.get(id) ?? 0) + 1);
        seqs.set(id, input.seq);
      });
    }
    expect(moved(start, r.positions())).toBeGreaterThanOrEqual(7);
    expect(driver.counts.rule).toBeGreaterThan(0);
    expect(driver.counts).toMatchObject({ jev: 0, fallback: 0, dropped: 0 });
  });

  test("decisions are staggered: no tick has more than one bot of nine deciding", () => {
    const calls: number[] = [];
    const brain: BotBrain = {
      decide: (v) => {
        calls.push(v.tick);
        return ruleBrain.decide(v);
      },
    };
    const r = room(9);
    const driver = new BotDriver({ brain });
    for (let t = 0; t < 120; t++) r.step(driver);
    const perTick = new Map<number, number>();
    for (const c of calls) perTick.set(c, (perTick.get(c) ?? 0) + 1);
    expect(Math.max(...perTick.values())).toBe(1);
  });

  test("decisions stay staggered after a long lobby and into the next match", () => {
    const calls: number[] = [];
    const brain: BotBrain = {
      decide: (v) => {
        calls.push(v.tick);
        return ruleBrain.decide(v);
      },
    };
    const r = room(9);
    const driver = new BotDriver({ brain });
    /** The busiest tick's decision count over `n` playing ticks, and the first decision's tick. */
    const play = (n: number) => {
      calls.length = 0;
      r.state.phase = "playing";
      const start = r.state.tick + 1;
      for (let t = 0; t < n; t++) r.step(driver);
      const perTick = new Map<number, number>();
      for (const c of calls) perTick.set(c, (perTick.get(c) ?? 0) + 1);
      return { busiest: Math.max(...perTick.values()), first: Math.min(...calls), start, ticks: perTick.size };
    };
    // The lobby: bots are fed (and their minds made) long before play.
    r.state.phase = "waiting";
    for (let t = 0; t < 200; t++) r.step(driver);
    expect(calls).toHaveLength(0);
    const first = play(120);
    expect(first.busiest).toBe(1);
    expect(first.ticks).toBeGreaterThan(9);
    expect(first.first).toBe(first.start);
    // The result, a new match, a warmup, then play again.
    calls.length = 0;
    r.state.phase = "ended";
    for (let t = 0; t < 90; t++) r.step(driver);
    driver.startMatch(MAP);
    r.state.phase = "warmup";
    for (let t = 0; t < 90; t++) r.step(driver);
    expect(calls).toHaveLength(0);
    const second = play(120);
    expect(second.busiest).toBe(1);
    expect(second.first).toBe(second.start);
  });

  test("an answer that never comes: given up after the timeout, the next decision is the rule brain's; bots keep playing", async () => {
    let asked = 0;
    const brain: BotBrain = {
      decide: () => {
        asked++;
        return new Promise<Goal>(() => {});
      },
    };
    const r = room(9);
    const driver = new BotDriver({ brain });
    const start = r.positions();
    await run(r, driver, 300);
    expect(moved(start, r.positions())).toBeGreaterThanOrEqual(7);
    expect(driver.counts.jev).toBe(0);
    // Every decision asked was given up (or is still out).
    expect(driver.counts.dropped).toBe(asked - driver.pending);
    expect(driver.counts.fallback).toBeGreaterThan(0);
    expect(driver.counts.fallback).toBeLessThanOrEqual(driver.counts.dropped);
  });

  test("the cap: never more than BOT_MAX_IN_FLIGHT decisions out, and a bot past it keeps its goal and tries again", async () => {
    let out = 0;
    let most = 0;
    const brain: BotBrain = {
      decide: (v) => {
        out++;
        most = Math.max(most, out);
        // Answers after half the timeout: several bots overlap.
        return new Promise<Goal>((resolve) =>
          setTimeout(() => {
            out--;
            resolve(ruleBrain.decide(v) as Goal);
          }, 5),
        );
      },
    };
    const r = room(9);
    const driver = new BotDriver({ brain });
    // No flush between ticks: every decision stays out for a while, so the cap is reached.
    for (let i = 0; i < BOT_DECISION_TIMEOUT - 1; i++) {
      r.step(driver);
      expect(driver.pending).toBeLessThanOrEqual(BOT_MAX_IN_FLIGHT);
    }
    expect(driver.pending).toBe(BOT_MAX_IN_FLIGHT);
    expect(most).toBe(BOT_MAX_IN_FLIGHT);
    // The answers come in, and are taken on the next tick.
    await new Promise((res) => setTimeout(res, 20));
    expect(driver.pending).toBe(0);
    r.step(driver);
    expect(driver.counts.jev).toBe(BOT_MAX_IN_FLIGHT);
    expect(driver.counts.dropped).toBe(0);
  });

  test("a rejected answer: dropped, and the next decision is the rule brain's", async () => {
    let asked = 0;
    const brain: BotBrain = {
      decide: () => {
        asked++;
        return Promise.reject(new Error("down"));
      },
    };
    const r = room(3);
    const driver = new BotDriver({ brain });
    const start = r.positions();
    await run(r, driver, 300);
    expect(moved(start, r.positions())).toBeGreaterThanOrEqual(2);
    expect(driver.counts.dropped).toBe(asked);
    expect(driver.counts.jev).toBe(0);
    // Each failure makes the next decision the rule brain's, which then gives the brain its turn again.
    expect(Math.abs(driver.counts.fallback - asked)).toBeLessThanOrEqual(3);
  });

  test("a brain that throws: caught, the tick goes on, the next decision is the rule brain's", () => {
    let asked = 0;
    const brain: BotBrain = {
      decide: () => {
        asked++;
        throw new Error("boom");
      },
    };
    const r = room(3);
    const driver = new BotDriver({ brain });
    for (let t = 0; t < 200; t++) r.step(driver);
    expect(asked).toBeGreaterThan(0);
    expect(driver.counts.dropped).toBe(asked);
    expect(driver.counts.fallback).toBeGreaterThan(0);
  });

  test("garbage answers (an unknown goal, a fight with no target, not an object): dropped, the goal kept", async () => {
    const answers: unknown[] = [{ kind: "dance" }, { kind: "fight" }, "roam", null, { kind: "loot", target: "1", source: "bag" }];
    let n = 0;
    const brain: BotBrain = { decide: () => Promise.resolve(answers[n++ % answers.length] as Goal) };
    const r = room(3);
    const driver = new BotDriver({ brain });
    const start = r.positions();
    await run(r, driver, 300);
    expect(moved(start, r.positions())).toBeGreaterThanOrEqual(2);
    expect(driver.counts.jev).toBe(0);
    expect(driver.counts.dropped).toBe(n);
  });

  test("a stale answer (an enemy that is gone): dropped when it comes in, no fallback for it", async () => {
    let n = 0;
    const brain: BotBrain = {
      decide: () => {
        n++;
        return Promise.resolve<Goal>({ kind: "fight", target: "bot:99" });
      },
    };
    const r = room(3);
    const driver = new BotDriver({ brain });
    await run(r, driver, 200);
    expect(n).toBeGreaterThan(0);
    expect(driver.counts.jev).toBe(0);
    expect(driver.counts.fallback).toBe(0);
    // The last answers may still wait for the bot's next tick.
    expect(driver.counts.dropped).toBeGreaterThanOrEqual(n - 3);
  });

  test("a good answer is taken; one that comes in after the timeout is ignored", async () => {
    const late: ((g: Goal) => void)[] = [];
    let slow = false;
    const brain: BotBrain = {
      decide: (v: BotView) => {
        if (slow) return new Promise<Goal>((resolve) => late.push(resolve));
        return Promise.resolve(ruleBrain.decide(v) as Goal);
      },
    };
    const r = room(1);
    const driver = new BotDriver({ brain });
    await run(r, driver, 70);
    expect(driver.counts.jev).toBeGreaterThan(0);
    const jev = driver.counts.jev;
    slow = true;
    // Until a decision is asked, then past its timeout.
    await run(r, driver, 2 * BOT_DECISION_TIMEOUT + 2);
    expect(late.length).toBeGreaterThan(0);
    expect(driver.counts.dropped).toBeGreaterThan(0);
    for (const resolve of late) resolve({ kind: "roam" });
    await run(r, driver, 2);
    expect(driver.counts.jev).toBe(jev);
  });

  test("a bot forgotten with a decision out: it no longer counts toward the cap", () => {
    const brain: BotBrain = { decide: () => new Promise<Goal>(() => {}) };
    const r = room(2);
    const driver = new BotDriver({ brain });
    for (let t = 0; t < 5; t++) r.step(driver);
    expect(driver.pending).toBe(2);
    driver.forget(r.ids[0]);
    expect(driver.pending).toBe(1);
  });

  test("outside play the bots stand still; a new match keeps their press counters and seq", () => {
    const r = room(2);
    const driver = new BotDriver({ brain: ruleBrain });
    let last: InputMessage[] = [];
    for (let t = 0; t < 200; t++) last = r.step(driver);
    r.state.phase = "waiting";
    const before = r.positions();
    const idle = r.step(driver);
    for (const input of idle) expect([input.mx, input.mz, input.fire]).toEqual([0, 0, false]);
    expect(r.positions()).toEqual(before);
    driver.startMatch(MAP);
    r.state.phase = "playing";
    const next = r.step(driver);
    next.forEach((input, i) => {
      expect(input.seq).toBe(last[i].seq + 2);
      for (const k of ["dash", "grenade", "shield", "reload", "switch", "swap", "use", "melee"] as const) expect(input[k]!).toBeGreaterThanOrEqual(last[i][k]!);
    });
  });

  test("saneGoal keeps only well-formed goals", () => {
    expect(saneGoal({ kind: "roam", extra: 1 })).toEqual({ kind: "roam" });
    expect(saneGoal({ kind: "loot", target: "3", source: "chest" })).toEqual({ kind: "loot", target: "3", source: "chest" });
    expect(saneGoal({ kind: "fight", target: "" })).toBeNull();
    expect(saneGoal({ kind: "fight", target: 3 })).toBeNull();
    expect(saneGoal(undefined)).toBeNull();
  });
});

/**
 * A duel, an FFA or a team deathmatch: bots on Crossroads (an FFA map) with
 * the loadout kit (DEFAULT_WEAPON, nothing else), no zone, no chests, no
 * floor items, playing. `at`: each bot's spot and team.
 */
function loadoutRoom(at: { x: number; z: number; team?: number }[]) {
  const map = mapById("crossroads");
  const state = new GameState();
  state.phase = "playing";
  const ids: string[] = [];
  at.forEach((s, i) => {
    const id = `bot:${i + 1}`;
    const p = new Player();
    p.weapon = DEFAULT_WEAPON;
    p.team = s.team ?? NO_TEAM;
    writeSim(p, spawnSim(s.x, s.z, DEFAULT_WEAPON));
    state.players.set(id, p);
    ids.push(id);
  });
  const world = (): BotWorld => ({ map, tick: state.tick, phase: state.phase, zone: state.zone, players: state.players, rewound: null, items: state.items, crates: state.crates });
  const step = (driver: BotDriver): InputMessage[] => {
    state.tick++;
    const w = world();
    return ids.map((id) => {
      const input = driver.input(w, id)!;
      expect(input).not.toBeNull();
      const p = state.players.get(id)!;
      writeSim(p, stepPlayer(map, readSim(p), input, p.weapon, { act: p.alive, armed: p.alive }, GRENADE_FRAG, "loadout").sim);
      return input;
    });
  };
  const positions = () => ids.map((id) => ({ x: state.players.get(id)!.x, z: state.players.get(id)!.z }));
  return { map, state, ids, step, positions };
}

describe("BotDriver: no zone, no loot (a duel, an FFA, a team deathmatch)", () => {
  test("two bots in sight of each other: they shoot; alone they roam the map's middle, never stuck on a spot", () => {
    const map = mapById("crossroads");
    const spawns = map.spawns.slice(0, 2);
    const r = loadoutRoom(spawns);
    const driver = new BotDriver({ brain: ruleBrain });
    let fired = 0;
    for (let t = 0; t < 600; t++) fired += r.step(driver).filter((i) => i.fire).length;
    // Roaming brought them into sight of each other, and they fired.
    expect(moved(spawns, r.positions())).toBe(2);
    expect(fired).toBeGreaterThan(0);
    // Every decision is the rule brain's, none a goal it can't follow with no zone or loot.
    expect(driver.counts).toMatchObject({ jev: 0, fallback: 0, dropped: 0 });
  });

  test("teammates alone never fire at each other, and still move", () => {
    const map = mapById("crossroads");
    const spawns = map.spawns.slice(0, 2).map((s) => ({ ...s, team: TEAM_RED }));
    const r = loadoutRoom(spawns);
    const driver = new BotDriver({ brain: ruleBrain });
    let fired = 0;
    for (let t = 0; t < 300; t++) fired += r.step(driver).filter((i) => i.fire).length;
    expect(fired).toBe(0);
    expect(moved(spawns, r.positions())).toBeGreaterThanOrEqual(1);
  });

  test("an enemy next to a teammate: shot at, the teammate never", () => {
    const r = loadoutRoom([
      { x: 0, z: 0, team: TEAM_RED },
      { x: 1.5, z: 0, team: TEAM_RED },
      { x: 0, z: 5, team: TEAM_BLUE },
    ]);
    const driver = new BotDriver({ brain: ruleBrain });
    let aimedAtFoe = 0;
    for (let t = 0; t < 60; t++) {
      const [mine] = r.step(driver);
      if (!mine.fire) continue;
      // Bot 1's shots go toward the blue one, never along the line to its red teammate.
      const foe = r.state.players.get(r.ids[2])!;
      const me = r.state.players.get(r.ids[0])!;
      const toFoe = Math.atan2(foe.z - me.z, foe.x - me.x);
      const off = Math.abs(Math.atan2(Math.sin(mine.aim - toFoe), Math.cos(mine.aim - toFoe)));
      expect(off).toBeLessThan(0.5);
      aimedAtFoe++;
    }
    expect(aimedAtFoe).toBeGreaterThan(0);
  });

  test("a dead bot stands still and decides nothing; respawned, it starts afresh and plays on", () => {
    const map = mapById("crossroads");
    const r = loadoutRoom(map.spawns.slice(0, 2));
    let decided = 0;
    const brain: BotBrain = {
      decide: (v) => {
        decided++;
        return ruleBrain.decide(v);
      },
    };
    const driver = new BotDriver({ brain });
    for (let t = 0; t < 60; t++) r.step(driver);
    const dead = r.state.players.get(r.ids[0])!;
    dead.alive = false;
    const before = decided;
    let last: InputMessage | undefined;
    for (let t = 0; t < 90; t++) {
      const [input] = r.step(driver);
      expect([input.mx, input.mz, input.fire]).toEqual([0, 0, false]);
      last = input;
    }
    // Only the living one decided meanwhile (once a second: 3 at most in 90 ticks).
    expect(decided - before).toBeLessThanOrEqual(3);
    // Back on a spawn, alive: a decision at once, and it moves off.
    const spawn = map.spawns[3];
    writeSim(dead, spawnSim(spawn.x, spawn.z, DEFAULT_WEAPON, readSim(dead)));
    dead.alive = true;
    const at = decided;
    const [first] = r.step(driver);
    expect(first.seq).toBe(last!.seq + 1);
    expect(decided).toBeGreaterThan(at);
    for (let t = 0; t < 120; t++) r.step(driver);
    expect(Math.hypot(dead.x - spawn.x, dead.z - spawn.z)).toBeGreaterThan(2);
  });
});
