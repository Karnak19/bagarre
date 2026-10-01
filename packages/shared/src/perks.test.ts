// Tests of the perks (PERKS in constants.ts, perks.ts) through the step
// (combat.ts), the way the server and the prediction run them: the double
// dash's second dash within its window, then its cooldown (and the second
// dash lost once the window runs out), the long dash's distance, the quick dash's cooldown, the bigger magazine (a spawn, a
// reload, a warmup pick), the quick reload and the royale's quicker switch.
// And that no perk changes nothing, and what a loadout pick may carry.
// Run with `bun run test` (or `bun test src/perks.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import type { Arena } from "./arena.ts";
import { equipSim, playerCan, spawnSim, stepPlayer } from "./combat.ts";
import { DASH, DASH_COOLDOWN_TICKS, NO_PERK, PERKS, PISTOL, ROYALE, WEAPONS, ticks, type PerkKey } from "./constants.ts";
import { parsePick } from "./messages.ts";
import { dashCooldownTicks, dashTimer, dashWindowTicks, dashesReady, isPerkPick, magazineOf, reloadTicksOf, switchTicks } from "./perks.ts";
import type { InputMessage, PlayerSim } from "./protocol.ts";
import { startKit } from "./royale.ts";

const RIFLE = WEAPONS.findIndex((w) => w.key === "rifle");
const SNIPER = WEAPONS.findIndex((w) => w.key === "sniper");
const perk = (key: PerkKey) => PERKS.findIndex((p) => p.key === key);
const DOUBLE = perk("double-dash");
const LONG = perk("long-dash");
const QUICK_DASH = perk("quick-dash");
const BIG_MAG = perk("big-mag");
const QUICK_HANDS = perk("quick-hands");

const open: Arena = { halfX: 40, halfZ: 40, obstacles: [] };
const can = playerCan(true, "playing");
const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
let seq = 0;
const step = (s: PlayerSim, extra: Partial<InputMessage> = {}) => stepPlayer(open, s, { ...idle, seq: ++seq, ...extra }, RIFLE, can);
/** A fresh player at the origin holding `p` (the server sets the perk, then spawns: spawnSim keeps it). */
const fresh = (p: number = NO_PERK, weapon = RIFLE) => spawnSim(0, 0, weapon, { ...spawnSim(0, 0, weapon), perk: p });
/** Steps with the same input until `done`, at most `max` times; returns the steps taken and the last result. */
function stepUntil(s: PlayerSim, extra: Partial<InputMessage>, done: (r: ReturnType<typeof step>) => boolean, max = 400) {
  let r = step(s, extra);
  let n = 1;
  while (!done(r) && n < max) {
    r = step(r.sim, extra);
    n++;
  }
  return { n, r };
}
/** Dashes along +X with press counter `press`, then waits the dash out (idle). Returns where it ended. */
function dash(s: PlayerSim, press: number): PlayerSim {
  let sim = step(s, { dash: press, mx: 1 }).sim;
  while (sim.dashTicks > 0) sim = step(sim, { dash: press }).sim;
  return sim;
}

describe("the table", () => {
  test("every perk changes something, and NO_PERK is out of the ids", () => {
    for (const p of PERKS) expect(Object.keys(p).length).toBeGreaterThan(2);
    expect(NO_PERK).toBeGreaterThanOrEqual(PERKS.length);
  });
  test("a loadout pick may carry a perk or none, nothing else", () => {
    expect(PERKS.every((_, i) => isPerkPick(i))).toBe(true);
    expect(isPerkPick(NO_PERK)).toBe(true);
    for (const bad of [-1, PERKS.length, 1.5, "0", null]) expect(isPerkPick(bad)).toBe(false);
    expect(parsePick({ perk: DOUBLE })).toEqual({ perk: DOUBLE });
    expect(parsePick({ perk: NO_PERK, weapon: RIFLE })).toEqual({ perk: NO_PERK, weapon: RIFLE });
    expect(parsePick({ perk: 99, weapon: RIFLE })).toBeNull();
  });
});

describe("no perk", () => {
  test("no second dash, the plain dash, the gun's own magazine and reload", () => {
    expect(dashWindowTicks(NO_PERK)).toBe(0);
    expect(dashCooldownTicks(NO_PERK)).toBe(DASH_COOLDOWN_TICKS);
    expect(magazineOf(WEAPONS[RIFLE], NO_PERK)).toBe(WEAPONS[RIFLE].magazine);
    expect(reloadTicksOf(WEAPONS[RIFLE], NO_PERK)).toBe(ticks(WEAPONS[RIFLE].reloadTime));
    expect(switchTicks(NO_PERK)).toBe(ticks(ROYALE.switchTime));
  });
  test("a second dash waits for the whole cooldown", () => {
    const after = dash(fresh(), 1);
    expect(after.x).toBeCloseTo(DASH.distance, 9);
    expect(step(after, { dash: 2, mx: 1 }).dashing).toBe(false);
  });
});

describe("Double dash", () => {
  const W = dashWindowTicks(DOUBLE);
  const CD = dashCooldownTicks(DOUBLE);
  test("the tuning: a 1 s window from the first dash, then 4 s of cooldown", () => {
    expect([PERKS[DOUBLE].dashWindow, PERKS[DOUBLE].dashCooldown]).toEqual([1, 4]);
    expect([W, CD]).toEqual([ticks(1), ticks(4)]);
    expect(dashesReady(0, DOUBLE)).toBe(2);
  });
  test("a second dash inside the window goes, a third is blocked, then 4 s of cooldown from the second", () => {
    const one = dash(fresh(DOUBLE), 1);
    expect(dashesReady(one.dashCd, DOUBLE)).toBe(1);
    expect(dashTimer(one.dashCd, DOUBLE).window).toBe(true);
    const second = step(one, { dash: 2, mx: 1 });
    expect(second.dashing).toBe(true);
    expect(second.sim.dashCd).toBe(CD);
    let s = second.sim;
    while (s.dashTicks > 0) s = step(s, { dash: 2 }).sim;
    expect(s.x).toBeCloseTo(2 * DASH.distance, 9);
    expect(dashesReady(s.dashCd, DOUBLE)).toBe(0);
    expect(step(s, { dash: 3, mx: 1 }).dashing).toBe(false);
    // Ready again exactly CD steps after the second dash.
    const back = stepUntil(second.sim, {}, (r) => r.sim.dashCd === 0);
    expect(back.n).toBe(CD);
    expect(step(back.r.sim, { dash: 4, mx: 1 }).dashing).toBe(true);
  });
  test("after the window, the second dash is lost: blocked, and the cooldown runs 4 s from the window's end", () => {
    // The first dash's press, then idle until the window closes.
    const first = step(fresh(DOUBLE), { dash: 1, mx: 1 });
    expect(first.sim.dashCd).toBe(W + CD);
    const closed = stepUntil(first.sim, { dash: 1 }, (r) => !dashTimer(r.sim.dashCd, DOUBLE).window);
    expect(closed.n).toBe(W);
    expect(closed.r.sim.dashCd).toBe(CD);
    expect(step(closed.r.sim, { dash: 2, mx: 1 }).dashing).toBe(false);
    const back = stepUntil(closed.r.sim, {}, (r) => r.sim.dashCd === 0);
    expect(back.n).toBe(CD);
  });
  test("the last step of the window still allows the second dash", () => {
    const first = step(fresh(DOUBLE), { dash: 1, mx: 1 });
    // W - 1 more steps: the next one is the window's last.
    let s = first.sim;
    for (let i = 0; i < W - 2; i++) s = step(s, { dash: 1 }).sim;
    expect(step(s, { dash: 2, mx: 1 }).dashing).toBe(true);
  });
  test("a perk swapped mid-window (royale) leaves no more than the new perk's cooldown", () => {
    const one = dash(fresh(DOUBLE), 1);
    const swapped = step({ ...one, perk: QUICK_DASH }, {});
    expect(swapped.sim.dashCd).toBeLessThanOrEqual(dashCooldownTicks(QUICK_DASH));
    expect(step({ ...one, perk: NO_PERK }, { dash: 2, mx: 1 }).dashing).toBe(false);
  });
});

describe("Long dash", () => {
  test(`covers ${DASH.distance * (PERKS[LONG].dashDistance ?? 1)} m in the same time`, () => {
    const plain = fresh();
    const long = fresh(LONG);
    let a = step(plain, { dash: 1, mx: 1 });
    let b = step(long, { dash: 1, mx: 1 });
    let n = 1;
    while (b.sim.dashTicks > 0) {
      a = step(a.sim, { dash: 1 });
      b = step(b.sim, { dash: 1 });
      n++;
    }
    expect(a.sim.dashTicks).toBe(0);
    expect(b.sim.x).toBeCloseTo(DASH.distance * (PERKS[LONG].dashDistance ?? 1), 9);
    expect(b.sim.x).toBeGreaterThan(a.sim.x);
  });
  test("its cooldown is the plain one", () => {
    expect(dash(fresh(LONG), 1).dashCd).toBe(dash(fresh(), 1).dashCd);
  });
});

describe("Quick dash", () => {
  const cd = dashCooldownTicks(QUICK_DASH);
  test(`the cooldown is ${PERKS[QUICK_DASH].dashCooldown} s instead of ${DASH.cooldown} s`, () => {
    expect(cd).toBe(ticks(PERKS[QUICK_DASH].dashCooldown ?? 0));
    expect(cd).toBeLessThan(DASH_COOLDOWN_TICKS);
  });
  test("the next dash goes once that cooldown has run", () => {
    const after = dash(fresh(QUICK_DASH), 1);
    const ready = stepUntil(after, {}, (r) => r.sim.dashCd === 0);
    expect(ready.n + 5).toBeLessThan(DASH_COOLDOWN_TICKS);
    expect(step(ready.r.sim, { dash: 2, mx: 1 }).dashing).toBe(true);
  });
});

describe("Bigger mag", () => {
  test("every gun's magazine is 30% bigger, in whole rounds", () => {
    const got = WEAPONS.map((w) => magazineOf(w, BIG_MAG));
    expect(got).toEqual(WEAPONS.map((w) => Math.round(w.magazine * 1.3)));
    expect(got).toEqual([16, 7, 5, 39, 8, 20, 10, 13]);
  });
  test("a spawn, a warmup pick and a reload fill it", () => {
    const big = magazineOf(WEAPONS[RIFLE], BIG_MAG);
    expect(fresh(BIG_MAG).ammo).toBe(big);
    expect(equipSim({ ...fresh(), perk: BIG_MAG }, SNIPER).ammo).toBe(magazineOf(WEAPONS[SNIPER], BIG_MAG));
    // Fire it empty: every round goes before the auto-reload, which refills the big magazine.
    const empty = stepUntil(fresh(BIG_MAG), { fire: true }, (r) => r.sim.ammo === 0);
    expect(empty.r.sim.reloadTicks).toBeGreaterThan(0);
    const full = stepUntil(empty.r.sim, {}, (r) => r.sim.reloadTicks === 0);
    expect(full.r.sim.ammo).toBe(big);
  });
  test("a manual reload works above the plain magazine", () => {
    const s = { ...fresh(BIG_MAG), ammo: WEAPONS[RIFLE].magazine };
    expect(step(s, { reload: 1 }).sim.reloadTicks).toBeGreaterThan(0);
  });
});

describe("Quick hands", () => {
  test("a reload takes 35% less time", () => {
    const w = WEAPONS[RIFLE];
    expect(reloadTicksOf(w, QUICK_HANDS)).toBe(ticks(w.reloadTime * 0.65));
    const s = { ...fresh(QUICK_HANDS), ammo: 1 };
    const r = step(s, { reload: 1 });
    expect(r.sim.reloadTicks).toBe(reloadTicksOf(w, QUICK_HANDS));
    const done = stepUntil(r.sim, { reload: 1 }, (x) => x.sim.reloadTicks === 0);
    expect(done.n).toBe(reloadTicksOf(w, QUICK_HANDS));
    expect(done.n).toBeLessThan(ticks(w.reloadTime));
  });
  test("the royale's gun switch is quicker too", () => {
    const kit = { ...startKit(), gun1: RIFLE, mag1: WEAPONS[RIFLE].magazine };
    const quick = { ...spawnSim(0, 0, PISTOL, undefined, kit), perk: QUICK_HANDS };
    const plain = spawnSim(0, 0, PISTOL, undefined, kit);
    const slotStep = (s: PlayerSim) => stepPlayer(open, s, { ...idle, seq: ++seq, switch: 1, slot: 1 }, PISTOL, can, 0, "slots");
    expect(slotStep(quick).sim.fireCd).toBe(switchTicks(QUICK_HANDS));
    expect(slotStep(plain).sim.fireCd).toBe(ticks(ROYALE.switchTime));
    expect(switchTicks(QUICK_HANDS)).toBeLessThan(ticks(ROYALE.switchTime));
  });
});
