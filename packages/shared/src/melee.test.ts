// Tests of the melee strike (V): the cone it reaches (range, angle, cover in
// the way), and what the step does with a press (combat.ts): the cooldown,
// the fire lockout after a strike, one strike per cooldown however fast V is
// mashed, a reload left running, nothing in warmup or while dead, a heal
// cancelled. And parseInput with and without the `melee` counter.
// Run with `bun run test` (or `bun test src/melee.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import type { Arena } from "./arena.ts";
import { meleeReaches, playerCan, spawnSim, stepPlayer } from "./combat.ts";
import { GRENADE_FRAG, HEAL_BANDAGE, MELEE, MELEE_COOLDOWN_TICKS, MELEE_LOCKOUT_TICKS, NO_HEAL, PLAYER_RADIUS, WEAPONS } from "./constants.ts";
import { parseInput } from "./messages.ts";
import type { InputMessage, PlayerSim } from "./protocol.ts";
import { HEAL_STOP, startKit } from "./royale.ts";

const RIFLE = WEAPONS.findIndex((w) => w.key === "rifle");
const open: Arena = { halfX: 40, halfZ: 40, obstacles: [] };
/** A wall 0.2 m thin across x = 1, from z = -5 to 5. */
const walled: Arena = { halfX: 40, halfZ: 40, obstacles: [{ x: 1, z: 0, w: 0.2, d: 10, h: 1.2 }] };
const can = playerCan(true, "playing");
const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
let seq = 0;
const step = (s: PlayerSim, extra: Partial<InputMessage> = {}, c: boolean | ReturnType<typeof playerCan> = can) =>
  stepPlayer(open, s, { ...idle, seq: ++seq, ...extra }, RIFLE, c);
const fresh = () => spawnSim(0, 0, RIFLE);
const reach = MELEE.range + PLAYER_RADIUS;
const at = (dist: number, angle: number) => ({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist });
const DEG = Math.PI / 180;

describe("the cone", () => {
  const me = { x: 0, z: 0 };
  test("the tuning: 1.6 m, 90°, 50 damage (two strikes kill), 0.8 s, 0.25 s without firing", () => {
    expect([MELEE.range, MELEE.angle, MELEE.damage, MELEE.cooldown, MELEE.fireLockout]).toEqual([1.6, Math.PI / 2, 50, 0.8, 0.25]);
  });
  test("an enemy right in front, and one at the very edge of the reach, are hit", () => {
    expect(meleeReaches(open, me, 0, at(1.2, 0))).toBe(true);
    expect(meleeReaches(open, me, 0, at(reach - 0.01, 0))).toBe(true);
  });
  test("past the reach (measured to the body's edge): nothing", () => {
    expect(meleeReaches(open, me, 0, at(reach + 0.01, 0))).toBe(false);
  });
  test("inside the 90° cone, either side of the aim, at any aim", () => {
    for (const aim of [0, 1, -2.5, Math.PI])
      for (const side of [1, -1]) expect(meleeReaches(open, me, aim, at(1.5, aim + side * 44 * DEG))).toBe(true);
  });
  test("beside you outside the cone, or behind you: nothing", () => {
    for (const aim of [0, 1, -2.5, Math.PI]) {
      for (const side of [1, -1]) expect(meleeReaches(open, me, aim, at(1.5, aim + side * 46 * DEG))).toBe(false);
      expect(meleeReaches(open, me, aim, at(1.2, aim + Math.PI))).toBe(false);
      expect(meleeReaches(open, me, aim, at(1.2, aim + Math.PI / 2))).toBe(false);
    }
  });
  test("bodies on top of each other: hit", () => {
    expect(meleeReaches(open, me, 0, { x: 0, z: 0 })).toBe(true);
  });
  test("a thin wall between the two, well within reach: nothing; beside the wall's end: hit", () => {
    // From (0.5, 0) to (1.5, 0): 1 m apart, across the 0.2 m wall.
    expect(meleeReaches(walled, { x: 0.5, z: 0 }, 0, { x: 1.5, z: 0 })).toBe(false);
    // The same, past the wall's end (z > 5).
    expect(meleeReaches(walled, { x: 0.5, z: 6 }, 0, { x: 1.5, z: 6 })).toBe(true);
  });
});

describe("a strike in the step", () => {
  test("a press strikes, starts the cooldown and holds the gun for the lockout", () => {
    const r = step(fresh(), { melee: 1 });
    expect(r.melee).toBe(true);
    expect(r.sim.meleeCd).toBe(MELEE_COOLDOWN_TICKS);
    expect(r.sim.fireCd).toBe(MELEE_LOCKOUT_TICKS);
    expect(r.sim.meleeSeen).toBe(1);
  });
  test("the trigger held through a strike: no shot on its input, the first one MELEE_LOCKOUT_TICKS later", () => {
    let r = step(fresh(), { melee: 1, fire: true });
    expect(r.fired).toBe(false);
    let n = 0;
    while (!r.fired && n < 100) {
      r = step(r.sim, { melee: 1, fire: true });
      n++;
    }
    expect(n).toBe(MELEE_LOCKOUT_TICKS);
  });
  test("no strike on a held counter, nor before the cooldown is over", () => {
    let r = step(fresh(), { melee: 1 });
    r = step(r.sim, { melee: 1 });
    expect(r.melee).toBe(false);
    r = step(r.sim, { melee: 2 });
    expect(r.melee).toBe(false);
    // That press was used up during the cooldown: it doesn't fire when it ends.
    for (let i = 0; i < MELEE_COOLDOWN_TICKS; i++) r = step(r.sim, { melee: 2 });
    expect(r.sim.meleeCd).toBe(0);
    expect(r.melee).toBe(false);
    expect(step(r.sim, { melee: 3 }).melee).toBe(true);
  });
  test("mashing V (a new press every input, or a big jump) gives one strike per cooldown", () => {
    let s = fresh();
    let strikes = 0;
    const inputs = 3 * MELEE_COOLDOWN_TICKS;
    for (let i = 1; i <= inputs; i++) {
      const r = step(s, { melee: i * 10 });
      if (r.melee) strikes++;
      s = r.sim;
    }
    expect(strikes).toBe(3);
    expect(step(fresh(), { melee: 1_000_000 }).sim.meleeCd).toBe(MELEE_COOLDOWN_TICKS);
  });
  test("a reload in progress goes on through a strike", () => {
    const s = { ...fresh(), ammo: 0, reloadTicks: 10 };
    let r = step(s, { melee: 1 });
    expect(r.melee).toBe(true);
    expect(r.sim.reloadTicks).toBe(9);
    for (let i = 0; i < 9; i++) r = step(r.sim, { melee: 1 });
    expect(r.sim.reloadTicks).toBe(0);
    expect(r.sim.ammo).toBe(WEAPONS[RIFLE].magazine);
  });
  test("a strike ends a burst in progress", () => {
    const BURST = WEAPONS.findIndex((w) => w.key === "burst-pistol");
    const s = spawnSim(0, 0, BURST);
    const first = stepPlayer(open, s, { ...idle, seq: ++seq, fire: true }, BURST, can);
    expect(first.sim.burstLeft).toBeGreaterThan(0);
    const r = stepPlayer(open, first.sim, { ...idle, seq: ++seq, melee: 1 }, BURST, can);
    expect([r.melee, r.fired, r.sim.burstLeft]).toEqual([true, false, 0]);
  });
  test("warmup: the press is used up and does nothing, then or once the match starts", () => {
    const warm = playerCan(true, "warmup");
    let r = step(fresh(), { melee: 1, fire: true }, warm);
    expect([r.melee, r.sim.meleeCd, r.sim.meleeSeen]).toEqual([false, 0, 1]);
    r = step(r.sim, { melee: 1 }, can);
    expect(r.melee).toBe(false);
  });
  test("dead, or the match over: no strike, the press used up", () => {
    for (const c of [playerCan(false, "playing"), playerCan(true, "ended")]) {
      const r = step(fresh(), { melee: 1 }, c);
      expect([r.melee, r.sim.meleeCd, r.sim.meleeSeen]).toEqual([false, 0, 1]);
    }
  });
  test("stunned: a strike still goes", () => {
    expect(step({ ...fresh(), stunTicks: 20 }, { melee: 1 }).melee).toBe(true);
  });
  test("an input without the counter (an older client) never strikes", () => {
    const r = step(fresh());
    expect([r.melee, r.sim.meleeSeen]).toEqual([false, 0]);
  });
  test("a respawn keeps the counter seen (a running total), and the cooldown starts clear", () => {
    const r = step(fresh(), { melee: 4 });
    const again = spawnSim(3, 3, RIFLE, r.sim);
    expect([again.meleeSeen, again.meleeCd]).toEqual([4, 0]);
  });
  test("battle royale: a strike cancels a heal in progress (the item kept)", () => {
    const s0 = spawnSim(0, 0, RIFLE, undefined, startKit());
    const s = { ...s0, hp: 50, kit: { ...s0.kit, bandages: 1 } };
    const healing = stepPlayer(open, s, { ...idle, seq: ++seq, use: 1, heal: HEAL_BANDAGE }, RIFLE, can, GRENADE_FRAG, "slots");
    expect(healing.sim.kit.heal).toBe(HEAL_BANDAGE);
    const r = stepPlayer(open, healing.sim, { ...idle, seq: ++seq, use: 1, heal: HEAL_BANDAGE, melee: 1 }, RIFLE, can, GRENADE_FRAG, "slots");
    expect([r.melee, r.sim.kit.heal, r.sim.kit.healStop, r.sim.kit.bandages]).toEqual([true, NO_HEAL, HEAL_STOP.melee, 1]);
  });
});

describe("parseInput and the melee counter", () => {
  const raw = { seq: 1, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
  test("missing (an older client): read as 0, not refused", () => {
    expect(parseInput(raw)?.melee).toBe(0);
  });
  test("present: kept", () => {
    expect(parseInput({ ...raw, melee: 7 })?.melee).toBe(7);
  });
  test("not a counter: the whole input is refused", () => {
    for (const melee of [-1, 1.5, "1", null, Number.NaN, 2 ** 33]) expect(parseInput({ ...raw, melee })).toBeNull();
  });
});
