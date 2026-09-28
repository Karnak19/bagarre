// Self-check of the utility grenades (src/grenades.ts) and what they lean on:
// the line-of-sight helpers (physics.ts), the stun in `stepPlayer`
// (combat.ts), the flash rule (angle, distance, cover), the smoke rule and
// the MSG_PICK parser. Run with `bun run check` (in packages/shared). Exits
// non-zero on a failure.

import type { Arena } from "../src/arena.ts";
import { spawnSim, stepPlayer } from "../src/combat.ts";
import {
  DASH_COOLDOWN_TICKS,
  FLASH,
  GRENADES,
  GRENADE_FLASH,
  GRENADE_FRAG,
  GRENADE_SMOKE,
  GRENADE_STUN,
  NO_TEAM,
  PLAYER_SPEED,
  STUN,
  STUN_TICKS,
  TEAM_BLUE,
  TEAM_RED,
  TICK_DT,
  TICK_RATE,
  ticks,
} from "../src/constants.ts";
import { flashTicks, grenadeCooldownTicks, isGrenadeType, smokeHides, smokeVeil } from "../src/grenades.ts";
import { parsePick } from "../src/messages.ts";
import { lineOfSight, segmentHitsBox, segmentHitsCircle } from "../src/physics.ts";
import type { InputMessage, PlayerSim } from "../src/protocol.ts";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// --- Line of sight ------------------------------------------------------------

// One 2 x 2 box at the origin, in a 20 x 20 arena.
const box = { x: 0, z: 0, w: 2, d: 2, h: 1 };
const arena: Arena = { halfX: 10, halfZ: 10, obstacles: [box] };
check(segmentHitsBox({ x: -5, z: 0 }, { x: 5, z: 0 }, box, 0), "a segment straight through a box hits it");
check(!segmentHitsBox({ x: -5, z: 3 }, { x: 5, z: 3 }, box, 0), "a segment passing beside a box misses it");
check(!segmentHitsBox({ x: -5, z: 1 }, { x: 5, z: 1 }, box, 0), "grazing a box's edge doesn't count");
check(!segmentHitsBox({ x: -5, z: 0 }, { x: -2, z: 0 }, box, 0), "a segment that stops short of a box misses it");
check(segmentHitsBox({ x: -5, z: 1.2 }, { x: 5, z: 1.2 }, box, 0.5), "the inflation radius widens the box");
check(!lineOfSight(arena, { x: -5, z: 0 }, { x: 5, z: 0 }), "lineOfSight: blocked across the box");
check(lineOfSight(arena, { x: -5, z: -5 }, { x: 5, z: -5 }), "lineOfSight: clear along an open row");
check(lineOfSight(arena, { x: -5, z: -5 }, { x: -5, z: -5 }), "lineOfSight: a point sees itself");

check(segmentHitsCircle({ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 0, z: 1 }, 2), "a segment crossing a circle hits it");
check(!segmentHitsCircle({ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 0, z: 3 }, 2), "a segment passing by a circle misses it");
check(!segmentHitsCircle({ x: -5, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 0 }, 2), "a segment ending before a circle misses it");
check(segmentHitsCircle({ x: 0.5, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 0 }, 2), "a segment starting inside a circle hits it");

// --- The stun in stepPlayer ---------------------------------------------------

const open: Arena = { halfX: 30, halfZ: 30, obstacles: [] };
const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
/** Walks east for `n` inputs from `s`; returns the end state. */
function walkEast(s: PlayerSim, n: number, from = 1, extra: Partial<InputMessage> = {}): PlayerSim {
  for (let i = 0; i < n; i++) s = stepPlayer(open, s, { ...idle, ...extra, seq: from + i, mx: 1 }, 0, true).sim;
  return s;
}
const fresh = spawnSim(0, 0, 0);
check(fresh.stunTicks === 0, "a fresh spawn is not stunned");

const free = walkEast(fresh, 10);
const stunned = walkEast({ ...fresh, stunTicks: STUN_TICKS }, 10);
check(near(free.x, 10 * PLAYER_SPEED * TICK_DT), `unstunned: full speed (${free.x.toFixed(3)} m in 10 steps)`);
check(near(stunned.x, 10 * PLAYER_SPEED * STUN.speedScale * TICK_DT), `stunned: ${STUN.speedScale * 100}% speed (${stunned.x.toFixed(3)} m in 10 steps)`);
check(stunned.stunTicks === STUN_TICKS - 10, "the stun counts down once per input");

// It runs out after exactly STUN_TICKS inputs, then full speed again.
let s = walkEast({ ...fresh, stunTicks: STUN_TICKS }, STUN_TICKS);
check(s.stunTicks === 0, `the stun is over after ${STUN_TICKS} inputs (${STUN.duration} s)`);
const x0 = s.x;
s = walkEast(s, 1, STUN_TICKS + 1);
check(near(s.x - x0, PLAYER_SPEED * TICK_DT), "full speed on the first input after the stun");

// A dash is blocked while stunned, and the press is used up (no dash when it ends).
let d = stepPlayer(open, { ...fresh, stunTicks: 5 }, { ...idle, seq: 1, mx: 1, dash: 1 }, 0, true);
check(!d.dashing && d.sim.dashTicks === 0 && d.sim.dashCd === 0, "stunned: a dash press doesn't dash (and starts no cooldown)");
check(d.sim.dashSeen === 1, "stunned: the dash press is used up");
let t = d.sim;
for (let i = 0; i < 6; i++) t = stepPlayer(open, t, { ...idle, seq: 2 + i, mx: 1, dash: 1 }, 0, true).sim;
check(t.dashTicks === 0 && t.dashCd === 0, "the press made during the stun doesn't dash once it ends");
d = stepPlayer(open, t, { ...idle, seq: 9, mx: 1, dash: 2 }, 0, true);
check(d.dashing && d.sim.dashCd === DASH_COOLDOWN_TICKS - 0, "a new press after the stun dashes");
// A dash under way is cut short by a stun.
const dashing = stepPlayer(open, fresh, { ...idle, seq: 1, mx: 1, dash: 1 }, 0, true).sim;
const cut = stepPlayer(open, { ...dashing, stunTicks: 10 }, { ...idle, seq: 2, mx: 1, dash: 1 }, 0, true);
check(!cut.dashing && cut.sim.dashTicks === 0, "a stun cuts a dash under way short");
// While dead the stun still counts down (nothing moves).
const dead = stepPlayer(open, { ...fresh, stunTicks: 4 }, { ...idle, seq: 1, mx: 1 }, 0, false).sim;
check(dead.stunTicks === 3 && dead.x === 0, "while dead the stun still runs out, nothing moves");

// Prediction: replaying the same inputs from a mid-stun snapshot lands on the same state.
const inputs = Array.from({ length: 40 }, (_, i) => ({ ...idle, seq: i + 1, mx: Math.cos(i / 7), mz: Math.sin(i / 5), dash: i > 20 ? 1 : 0 }));
let full: PlayerSim = { ...fresh, stunTicks: 25 };
let mid: PlayerSim | null = null;
for (const [i, inp] of inputs.entries()) {
  full = stepPlayer(open, full, inp, 0, true).sim;
  if (i === 14) mid = { ...full };
}
let replay = mid!;
for (const inp of inputs.slice(15)) replay = stepPlayer(open, replay, inp, 0, true).sim;
check(JSON.stringify(replay) === JSON.stringify(full), "replaying from a mid-stun state is bit-identical (no rubber-banding)");

// --- Cooldowns per type ---------------------------------------------------------

check(GRENADES.length === 4 && [GRENADE_FRAG, GRENADE_SMOKE, GRENADE_STUN, GRENADE_FLASH].join() === "0,1,2,3", "four grenade types, in table order");
for (const [i, g] of GRENADES.entries()) {
  const r = stepPlayer(open, fresh, { ...idle, seq: 1, grenade: 1, gx: 3 }, 0, true, i);
  check(!!r.grenade && r.sim.grenadeCd === ticks(g.cooldown) && grenadeCooldownTicks(i) === ticks(g.cooldown), `${g.name}: a throw starts its own ${g.cooldown} s cooldown`);
}
check(isGrenadeType(0) && isGrenadeType(3) && !isGrenadeType(4) && !isGrenadeType(-1) && !isGrenadeType(1.5) && !isGrenadeType("1"), "isGrenadeType accepts only listed types");

// --- The flash rule --------------------------------------------------------------

const blast = { x: 0, z: -5 };
const eye = { x: 0, z: -5 - FLASH.fullRange }; // straight south of it, in the open
const north = Math.PI / 2; // aim toward +z: at the blast
const max = Math.round(FLASH.maxDuration * TICK_RATE);
check(flashTicks(arena, eye, north, blast) === max, `aiming straight at it, close: the full ${FLASH.maxDuration} s`);
check(flashTicks(arena, eye, -north, blast) === 0, "aiming away: nothing");
check(flashTicks(arena, eye, 0, blast) === 0, "aiming across it (90°): nothing");
const at30 = flashTicks(arena, eye, north - Math.PI / 6, blast);
const at60 = flashTicks(arena, eye, north - Math.PI / 3, blast);
check(max > at30 && at30 > at60 && at60 > 0, `the farther the aim from it, the shorter (0°: ${max}, 30°: ${at30}, 60°: ${at60} ticks)`);
const far1 = flashTicks(arena, { x: 0, z: -5 - 7 }, north, blast);
const far2 = flashTicks(arena, { x: 0, z: -5 - 11 + 1 }, north, blast);
check(max > far1 && far1 > far2 && far2 > 0, `the farther away, the shorter (4 m: ${max}, 7 m: ${far1}, 10 m: ${far2} ticks)`);
check(flashTicks({ ...open }, { x: 0, z: -5 - FLASH.range - 0.5 }, north, blast) === 0, `beyond ${FLASH.range} m: nothing`);
// Behind cover: the box at the origin between the eye and a blast north of it.
check(flashTicks(arena, { x: 0, z: -4 }, north, { x: 0, z: 4 }) === 0, "cover between the eye and the blast: nothing");
check(flashTicks(arena, { x: -4, z: -4 }, Math.PI / 4, { x: 4, z: 4 }) === 0, "cover across the diagonal: nothing");
check(flashTicks(open, { x: 0, z: -4 }, north, { x: 0, z: 4 }) > 0, "the same look with no cover: flashed");
check(flashTicks(arena, { x: 0, z: -5.5 }, -north, blast) === max, "point blank: flashed whatever the aim");

// --- Smoke ------------------------------------------------------------------------

const cloud = [{ x: 0, z: 0 }];
check(smokeHides({ x: -10, z: 0 }, { x: 1, z: 0 }, cloud, 4), "a target inside the cloud is hidden");
check(smokeHides({ x: -10, z: 0 }, { x: 8, z: 0 }, cloud, 4), "a target behind the cloud is hidden");
check(!smokeHides({ x: -10, z: 0 }, { x: -6, z: 0 }, cloud, 4), "a target in front of the cloud is seen");
check(!smokeHides({ x: -10, z: 6 }, { x: 10, z: 6 }, cloud, 4), "a line passing beside the cloud: seen");
check(smokeHides({ x: 1, z: 0 }, { x: -10, z: 0 }, cloud, 4), "from inside the cloud nobody outside is seen");
check(!smokeHides({ x: -10, z: 0 }, { x: 1, z: 0 }, [], 4), "no cloud: seen");
check(smokeVeil(NO_TEAM, NO_TEAM, false, true) === "hidden", "an enemy in smoke is hidden (duel, FFA)");
check(smokeVeil(TEAM_RED, TEAM_BLUE, false, true) === "hidden", "an enemy in smoke is hidden (teams)");
check(smokeVeil(TEAM_RED, TEAM_RED, false, true) === "none", "a teammate in smoke is still seen");
check(smokeVeil(NO_TEAM, NO_TEAM, true, true) === "none", "you always see yourself");
check(smokeVeil(null, TEAM_RED, false, true) === "faded", "a spectator sees a player in smoke faded");
check(smokeVeil(NO_TEAM, NO_TEAM, false, false) === "none" && smokeVeil(null, NO_TEAM, false, false) === "none", "out of the smoke: seen by all");

// --- MSG_PICK -----------------------------------------------------------------------

check(JSON.stringify(parsePick({ weapon: 2 })) === '{"weapon":2}', "pick: a weapon alone");
check(JSON.stringify(parsePick({ grenade: 3 })) === '{"grenade":3}', "pick: a grenade alone");
check(JSON.stringify(parsePick({ weapon: 1, grenade: 1 })) === '{"weapon":1,"grenade":1}', "pick: both");
for (const bad of [{}, null, [], "x", { grenade: 4 }, { grenade: -1 }, { grenade: 1.5 }, { grenade: "1" }, { weapon: 1, grenade: 9 }, { weapon: 99, grenade: 1 }, { grenade: null }])
  check(parsePick(bad) === null, `pick: refused ${JSON.stringify(bad)}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall grenade checks passed");
