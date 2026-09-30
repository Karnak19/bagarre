// Tests of the utility grenades (grenades.ts) and what they lean on: the
// line-of-sight helpers (physics.ts), the stun in `stepPlayer` (combat.ts),
// the flash rule (angle, distance, cover), the smoke rule and the heal rule
// (who, how much, cover) and the MSG_PICK parser.
// Run with `bun run test` (or `bun test src/grenades.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import type { Arena } from "./arena.ts";
import { grenadeAffects, spawnSim, stepPlayer } from "./combat.ts";
import {
  DASH_COOLDOWN_TICKS,
  FLASH,
  GRENADES,
  HEAL,
  MAX_HP,
  NO_TEAM,
  PLAYER_SPEED,
  STUN,
  STUN_TICKS,
  TEAM_BLUE,
  TEAM_RED,
  TICK_DT,
  TICK_RATE,
  ticks,
} from "./constants.ts";
import { flashTicks, grenadeCooldownTicks, healAmount, isGrenadeType, ownsCloud, smokeCover, smokeHides, smokeVeil } from "./grenades.ts";
import { parsePick } from "./messages.ts";
import { lineOfSight, segmentHitsBox, segmentHitsCircle } from "./physics.ts";
import type { InputMessage, PlayerSim } from "./protocol.ts";

// One 2 x 2 box at the origin, in a 20 x 20 arena.
const box = { x: 0, z: 0, w: 2, d: 2, h: 1 };
const arena: Arena = { halfX: 10, halfZ: 10, obstacles: [box] };
const open: Arena = { halfX: 30, halfZ: 30, obstacles: [] };

describe("line of sight", () => {
  test("a segment straight through a box hits it", () => {
    expect(segmentHitsBox({ x: -5, z: 0 }, { x: 5, z: 0 }, box, 0)).toBe(true);
  });
  test("a segment passing beside a box misses it", () => {
    expect(segmentHitsBox({ x: -5, z: 3 }, { x: 5, z: 3 }, box, 0)).toBe(false);
  });
  test("grazing a box's edge doesn't count", () => {
    expect(segmentHitsBox({ x: -5, z: 1 }, { x: 5, z: 1 }, box, 0)).toBe(false);
  });
  test("a segment that stops short of a box misses it", () => {
    expect(segmentHitsBox({ x: -5, z: 0 }, { x: -2, z: 0 }, box, 0)).toBe(false);
  });
  test("the inflation radius widens the box", () => {
    expect(segmentHitsBox({ x: -5, z: 1.2 }, { x: 5, z: 1.2 }, box, 0.5)).toBe(true);
  });
  test("lineOfSight: blocked across the box", () => {
    expect(lineOfSight(arena, { x: -5, z: 0 }, { x: 5, z: 0 })).toBe(false);
  });
  test("lineOfSight: clear along an open row", () => {
    expect(lineOfSight(arena, { x: -5, z: -5 }, { x: 5, z: -5 })).toBe(true);
  });
  test("lineOfSight: a point sees itself", () => {
    expect(lineOfSight(arena, { x: -5, z: -5 }, { x: -5, z: -5 })).toBe(true);
  });

  test("a segment crossing a circle hits it", () => {
    expect(segmentHitsCircle({ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 0, z: 1 }, 2)).toBe(true);
  });
  test("a segment passing by a circle misses it", () => {
    expect(segmentHitsCircle({ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 0, z: 3 }, 2)).toBe(false);
  });
  test("a segment ending before a circle misses it", () => {
    expect(segmentHitsCircle({ x: -5, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 0 }, 2)).toBe(false);
  });
  test("a segment starting inside a circle hits it", () => {
    expect(segmentHitsCircle({ x: 0.5, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 0 }, 2)).toBe(true);
  });
});

const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
/** Walks east for `n` inputs from `s`; returns the end state. */
function walkEast(s: PlayerSim, n: number, from = 1, extra: Partial<InputMessage> = {}): PlayerSim {
  for (let i = 0; i < n; i++) s = stepPlayer(open, s, { ...idle, ...extra, seq: from + i, mx: 1 }, 0, true).sim;
  return s;
}
const fresh = spawnSim(0, 0, 0);

describe("the stun in stepPlayer", () => {
  test("a fresh spawn is not stunned", () => {
    expect(fresh.stunTicks).toBe(0);
  });

  const free = walkEast(fresh, 10);
  const stunned = walkEast({ ...fresh, stunTicks: STUN_TICKS }, 10);
  test(`unstunned: full speed (${free.x.toFixed(3)} m in 10 steps)`, () => {
    expect(free.x).toBeCloseTo(10 * PLAYER_SPEED * TICK_DT, 6);
  });
  test(`stunned: ${STUN.speedScale * 100}% speed (${stunned.x.toFixed(3)} m in 10 steps)`, () => {
    expect(stunned.x).toBeCloseTo(10 * PLAYER_SPEED * STUN.speedScale * TICK_DT, 6);
  });
  test("the stun counts down once per input", () => {
    expect(stunned.stunTicks).toBe(STUN_TICKS - 10);
  });

  // It runs out after exactly STUN_TICKS inputs, then full speed again.
  const over = walkEast({ ...fresh, stunTicks: STUN_TICKS }, STUN_TICKS);
  test(`the stun is over after ${STUN_TICKS} inputs (${STUN.duration} s)`, () => {
    expect(over.stunTicks).toBe(0);
  });
  test("full speed on the first input after the stun", () => {
    const after = walkEast(over, 1, STUN_TICKS + 1);
    expect(after.x - over.x).toBeCloseTo(PLAYER_SPEED * TICK_DT, 6);
  });

  // A dash is blocked while stunned, and the press is used up (no dash when it ends).
  const pressed = stepPlayer(open, { ...fresh, stunTicks: 5 }, { ...idle, seq: 1, mx: 1, dash: 1 }, 0, true);
  test("stunned: a dash press doesn't dash (and starts no cooldown)", () => {
    expect(pressed.dashing).toBe(false);
    expect(pressed.sim.dashTicks).toBe(0);
    expect(pressed.sim.dashCd).toBe(0);
  });
  test("stunned: the dash press is used up", () => {
    expect(pressed.sim.dashSeen).toBe(1);
  });
  let t = pressed.sim;
  for (let i = 0; i < 6; i++) t = stepPlayer(open, t, { ...idle, seq: 2 + i, mx: 1, dash: 1 }, 0, true).sim;
  const held = t;
  test("the press made during the stun doesn't dash once it ends", () => {
    expect(held.dashTicks).toBe(0);
    expect(held.dashCd).toBe(0);
  });
  test("a new press after the stun dashes", () => {
    const d = stepPlayer(open, held, { ...idle, seq: 9, mx: 1, dash: 2 }, 0, true);
    expect(d.dashing).toBe(true);
    expect(d.sim.dashCd).toBe(DASH_COOLDOWN_TICKS - 0);
  });
  // A dash under way is cut short by a stun.
  test("a stun cuts a dash under way short", () => {
    const dashing = stepPlayer(open, fresh, { ...idle, seq: 1, mx: 1, dash: 1 }, 0, true).sim;
    const cut = stepPlayer(open, { ...dashing, stunTicks: 10 }, { ...idle, seq: 2, mx: 1, dash: 1 }, 0, true);
    expect(cut.dashing).toBe(false);
    expect(cut.sim.dashTicks).toBe(0);
  });
  // While dead the stun still counts down (nothing moves).
  test("while dead the stun still runs out, nothing moves", () => {
    const dead = stepPlayer(open, { ...fresh, stunTicks: 4 }, { ...idle, seq: 1, mx: 1 }, 0, false).sim;
    expect(dead.stunTicks).toBe(3);
    expect(dead.x).toBe(0);
  });

  // Prediction: replaying the same inputs from a mid-stun snapshot lands on the same state.
  test("replaying from a mid-stun state is bit-identical (no rubber-banding)", () => {
    const inputs = Array.from({ length: 40 }, (_, i) => ({ ...idle, seq: i + 1, mx: Math.cos(i / 7), mz: Math.sin(i / 5), dash: i > 20 ? 1 : 0 }));
    let full: PlayerSim = { ...fresh, stunTicks: 25 };
    let mid: PlayerSim | null = null;
    for (const [i, inp] of inputs.entries()) {
      full = stepPlayer(open, full, inp, 0, true).sim;
      if (i === 14) mid = { ...full };
    }
    let replay = mid!;
    for (const inp of inputs.slice(15)) replay = stepPlayer(open, replay, inp, 0, true).sim;
    expect(JSON.stringify(replay)).toBe(JSON.stringify(full));
  });
});

describe("cooldowns per type", () => {
  for (const [i, g] of GRENADES.entries())
    test(`${g.name}: a throw starts its own ${g.cooldown} s cooldown`, () => {
      const r = stepPlayer(open, fresh, { ...idle, seq: 1, grenade: 1, gx: 3 }, 0, true, i);
      expect(r.grenade).toBeTruthy();
      expect(r.sim.grenadeCd).toBe(ticks(g.cooldown));
      expect(grenadeCooldownTicks(i)).toBe(ticks(g.cooldown));
    });
  test("isGrenadeType accepts only listed types", () => {
    const last = GRENADES.length - 1;
    expect(isGrenadeType(0)).toBe(true);
    expect(isGrenadeType(last)).toBe(true);
    expect(isGrenadeType(last + 1)).toBe(false);
    expect(isGrenadeType(-1)).toBe(false);
    expect(isGrenadeType(1.5)).toBe(false);
    expect(isGrenadeType("1")).toBe(false);
  });
});

describe("the flash rule", () => {
  const blast = { x: 0, z: -5 };
  const eye = { x: 0, z: -5 - FLASH.fullRange }; // straight south of it, in the open
  const north = Math.PI / 2; // aim toward +z: at the blast
  const max = Math.round(FLASH.maxDuration * TICK_RATE);
  test(`aiming straight at it, close: the full ${FLASH.maxDuration} s`, () => {
    expect(flashTicks(arena, eye, north, blast)).toBe(max);
  });
  const away = flashTicks(arena, eye, -north, blast);
  const across = flashTicks(arena, eye, 0, blast);
  test(`still flashed when turned away, just shorter (facing: ${max}, across 90°: ${across}, away: ${away} ticks)`, () => {
    expect(max).toBeGreaterThan(across);
    expect(across).toBeGreaterThan(away);
    expect(away).toBeGreaterThan(0);
  });
  test(`aiming away: about ${FLASH.backFactor} of the full length`, () => {
    expect(Math.abs(away - max * FLASH.backFactor)).toBeLessThanOrEqual(1);
  });
  const at30 = flashTicks(arena, eye, north - Math.PI / 6, blast);
  const at60 = flashTicks(arena, eye, north - Math.PI / 3, blast);
  test(`the farther the aim from it, the shorter (0°: ${max}, 30°: ${at30}, 60°: ${at60} ticks)`, () => {
    expect(max).toBeGreaterThan(at30);
    expect(at30).toBeGreaterThan(at60);
    expect(at60).toBeGreaterThan(0);
  });
  const far1 = flashTicks(arena, { x: 0, z: -5 - 7 }, north, blast);
  const far2 = flashTicks(arena, { x: 0, z: -5 - 11 + 1 }, north, blast);
  test(`the farther away, the shorter (4 m: ${max}, 7 m: ${far1}, 10 m: ${far2} ticks)`, () => {
    expect(max).toBeGreaterThan(far1);
    expect(far1).toBeGreaterThan(far2);
    expect(far2).toBeGreaterThan(0);
  });
  test(`beyond ${FLASH.range} m: nothing`, () => {
    expect(flashTicks({ ...open }, { x: 0, z: -5 - FLASH.range - 0.5 }, north, blast)).toBe(0);
  });
  // Behind cover: the box at the origin between the eye and a blast north of it.
  test("cover between the eye and the blast: nothing", () => {
    expect(flashTicks(arena, { x: 0, z: -4 }, north, { x: 0, z: 4 })).toBe(0);
  });
  test("cover across the diagonal: nothing", () => {
    expect(flashTicks(arena, { x: -4, z: -4 }, Math.PI / 4, { x: 4, z: 4 })).toBe(0);
  });
  test("the same look with no cover: flashed", () => {
    expect(flashTicks(open, { x: 0, z: -4 }, north, { x: 0, z: 4 })).toBeGreaterThan(0);
  });
  test("point blank: flashed whatever the aim", () => {
    expect(flashTicks(arena, { x: 0, z: -5.5 }, -north, blast)).toBe(max);
  });
});

describe("the heal rule", () => {
  // Who: the thrower and their teammates, written as `self || sameTeam`, never `!canDamage`.
  test("heal, teams: a teammate is healed", () => {
    expect(grenadeAffects("allies", TEAM_RED, TEAM_RED, false)).toBe(true);
  });
  test("heal, teams: an enemy is not", () => {
    expect(grenadeAffects("allies", TEAM_RED, TEAM_BLUE, false)).toBe(false);
  });
  test("heal, teams: the thrower is healed", () => {
    expect(grenadeAffects("allies", TEAM_RED, TEAM_RED, true)).toBe(true);
  });
  test("heal, duel / FFA: the thrower is healed", () => {
    expect(grenadeAffects("allies", NO_TEAM, NO_TEAM, true)).toBe(true);
  });
  test("heal, duel / FFA: anyone else is not", () => {
    expect(grenadeAffects("allies", NO_TEAM, NO_TEAM, false)).toBe(false);
  });
  test("the frag's rule is unchanged (canDamage)", () => {
    expect(grenadeAffects("enemies", NO_TEAM, NO_TEAM, true)).toBe(true);
    expect(grenadeAffects("enemies", NO_TEAM, NO_TEAM, false)).toBe(true);
    expect(grenadeAffects("enemies", TEAM_RED, TEAM_RED, false)).toBe(false);
  });
  // How much: HEAL.amount flat across the radius, capped at MAX_HP.
  const hb = { x: 0, z: -5 };
  test(`on the blast: +${HEAL.amount} HP`, () => {
    expect(healAmount(open, { x: 0, z: -5 }, 30, hb)).toBe(HEAL.amount);
  });
  test("at the edge of the radius: the same amount (no falloff)", () => {
    expect(healAmount(open, { x: HEAL.radius, z: -5 }, 30, hb)).toBe(HEAL.amount);
  });
  test("out of the radius: nothing", () => {
    expect(healAmount(open, { x: HEAL.radius + 1, z: -5 }, 30, hb)).toBe(0);
  });
  test(`capped at MAX_HP (${MAX_HP - 10} HP gets +10)`, () => {
    expect(healAmount(open, hb, MAX_HP - 10, hb)).toBe(10);
  });
  test("full health: nothing", () => {
    expect(healAmount(open, hb, MAX_HP, hb)).toBe(0);
  });
  test("dead (0 HP): not brought back", () => {
    expect(healAmount(open, hb, 0, hb)).toBe(0);
  });
  // Cover: the box at the origin between the blast and the player.
  test("cover between the blast and the player: nothing", () => {
    expect(healAmount(arena, { x: 0, z: 1.8 }, 30, { x: 0, z: -1.8 })).toBe(0);
  });
  test("the same spot with no cover: healed", () => {
    expect(healAmount(open, { x: 0, z: 1.8 }, 30, { x: 0, z: -1.8 })).toBe(HEAL.amount);
  });
});

describe("smoke", () => {
  const cloud = [{ x: 0, z: 0 }];
  test("a target inside the cloud is hidden", () => {
    expect(smokeHides({ x: -10, z: 0 }, { x: 1, z: 0 }, cloud, 4)).toBe(true);
  });
  test("a target behind the cloud is hidden", () => {
    expect(smokeHides({ x: -10, z: 0 }, { x: 8, z: 0 }, cloud, 4)).toBe(true);
  });
  test("a target in front of the cloud is seen", () => {
    expect(smokeHides({ x: -10, z: 0 }, { x: -6, z: 0 }, cloud, 4)).toBe(false);
  });
  test("a line passing beside the cloud: seen", () => {
    expect(smokeHides({ x: -10, z: 6 }, { x: 10, z: 6 }, cloud, 4)).toBe(false);
  });
  test("from inside the cloud nobody outside is seen", () => {
    expect(smokeHides({ x: 1, z: 0 }, { x: -10, z: 0 }, cloud, 4)).toBe(true);
  });
  test("no cloud: seen", () => {
    expect(smokeHides({ x: -10, z: 0 }, { x: 1, z: 0 }, [], 4)).toBe(false);
  });
  test("an enemy in smoke is hidden (duel, FFA)", () => {
    expect(smokeVeil(NO_TEAM, NO_TEAM, false, "foreign")).toBe("hidden");
  });
  test("an enemy in smoke is hidden (teams)", () => {
    expect(smokeVeil(TEAM_RED, TEAM_BLUE, false, "foreign")).toBe("hidden");
  });
  test("a teammate in smoke is still seen", () => {
    expect(smokeVeil(TEAM_RED, TEAM_RED, false, "foreign")).toBe("none");
  });
  test("you always see yourself", () => {
    expect(smokeVeil(NO_TEAM, NO_TEAM, true, "foreign")).toBe("none");
  });
  test("a spectator sees a player in smoke faded", () => {
    expect(smokeVeil(null, TEAM_RED, false, "foreign")).toBe("faded");
  });
  test("out of the smoke: seen by all", () => {
    expect(smokeVeil(NO_TEAM, NO_TEAM, false, "none")).toBe("none");
    expect(smokeVeil(null, NO_TEAM, false, "none")).toBe("none");
  });

  // Whose cloud it is: the thrower's side sees through it (faded), everyone else is blocked.
  const redCloud = { owner: "r1", team: TEAM_RED };
  const ffaCloud = { owner: "f1", team: NO_TEAM };
  test("teams: the thrower and their teammates own the cloud", () => {
    expect(ownsCloud("r1", TEAM_RED, redCloud)).toBe(true);
    expect(ownsCloud("r2", TEAM_RED, redCloud)).toBe(true);
  });
  test("teams: the other team does not", () => {
    expect(ownsCloud("b1", TEAM_BLUE, redCloud)).toBe(false);
  });
  test("duel/FFA: only the thrower owns it (NO_TEAM is not a team)", () => {
    expect(ownsCloud("f1", NO_TEAM, ffaCloud)).toBe(true);
    expect(ownsCloud("f2", NO_TEAM, ffaCloud)).toBe(false);
  });
  test("a spectator owns no cloud", () => {
    expect(ownsCloud(null, null, redCloud)).toBe(false);
  });
  const mineOf = (id: string | null, team: number | null, cs: { x: number; z: number; owner: string; team: number }[]) =>
    cs.map((c) => ({ x: c.x, z: c.z, mine: ownsCloud(id, team, c) }));
  const nearCloud = { x: 0, z: 0, ...redCloud };
  const far = { x: 6, z: 0, owner: "b1", team: TEAM_BLUE };
  const from = { x: -10, z: 0 };
  const to = { x: 1, z: 0 };
  const behindBoth = { x: 12, z: 0 };
  test("own team's cloud in the way: cover is own", () => {
    expect(smokeCover(from, to, mineOf("r2", TEAM_RED, [nearCloud]), 4)).toBe("own");
  });
  test("enemy team's cloud in the way: cover is foreign", () => {
    expect(smokeCover(from, to, mineOf("b1", TEAM_BLUE, [nearCloud]), 4)).toBe("foreign");
  });
  test("no cloud in the way: no cover", () => {
    expect(smokeCover(from, to, [], 4)).toBe("none");
  });
  test("own cloud and a foreign one in the chain: foreign", () => {
    expect(smokeCover(from, behindBoth, mineOf("r2", TEAM_RED, [nearCloud, far]), 4)).toBe("foreign");
  });
  test("two own clouds in the chain: own", () => {
    expect(smokeCover(from, behindBoth, mineOf("r2", TEAM_RED, [nearCloud, { ...far, owner: "r3", team: TEAM_RED }]), 4)).toBe("own");
  });
  test("the thrower's team sees an enemy in its smoke faded", () => {
    expect(smokeVeil(TEAM_RED, TEAM_BLUE, false, "own")).toBe("faded");
  });
  test("the other team still sees nothing", () => {
    expect(smokeVeil(TEAM_BLUE, TEAM_RED, false, "foreign")).toBe("hidden");
  });
  test("FFA: the thrower sees others in their smoke faded", () => {
    expect(smokeVeil(NO_TEAM, NO_TEAM, false, "own")).toBe("faded");
  });
  test("a spectator still sees it faded", () => {
    expect(smokeVeil(null, TEAM_RED, false, smokeCover(from, to, mineOf(null, null, [nearCloud]), 4))).toBe("faded");
  });
});

describe("MSG_PICK", () => {
  test("pick: a weapon alone", () => {
    expect(JSON.stringify(parsePick({ weapon: 2 }))).toBe('{"weapon":2}');
  });
  test("pick: a grenade alone", () => {
    expect(JSON.stringify(parsePick({ grenade: 3 }))).toBe('{"grenade":3}');
  });
  test("pick: both", () => {
    expect(JSON.stringify(parsePick({ weapon: 1, grenade: 1 }))).toBe('{"weapon":1,"grenade":1}');
  });
  const bad: unknown[] = [{}, null, [], "x", { grenade: GRENADES.length }, { grenade: -1 }, { grenade: 1.5 }, { grenade: "1" }, { weapon: 1, grenade: GRENADES.length + 5 }, { weapon: 99, grenade: 1 }, { grenade: null }];
  for (const b of bad)
    test(`pick: refused ${JSON.stringify(b)}`, () => {
      expect(parsePick(b)).toBeNull();
    });
});
