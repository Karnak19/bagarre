// Self-check of the battle royale's rules (src/royale.ts, rankRoyale in
// src/modes.ts): the ranking by order of knock-out, the zone over time, the
// grenade stacks, the gun slots (and the step's switch, which the client
// predicts), the loot table, and the royale maps' crate spots.
// Run with `bun run check` (in packages/shared). Exits non-zero on a failure.

import { playerCan, spawnSim, stepPlayer } from "../src/combat.ts";
import { GRENADES, GRENADE_FRAG, GRENADE_SMOKE, LOOT, PISTOL, PLAYER_RADIUS, ROYALE, TICK_RATE, WEAPONS, ZONE, ticks } from "../src/constants.ts";
import { ROYALE_MAPS } from "../src/maps/index.ts";
import { lotOf, rankRoyale, ROYALE_RULES, type RoyaleStanding } from "../src/modes.ts";
import { circleOverlapsBox } from "../src/physics.ts";
import type { InputMessage, PlayerSim, ZoneView } from "../src/protocol.ts";
import {
  NO_GUN,
  carriedGuns,
  cycleSlot,
  freeGunSlot,
  gunAt,
  gunInHand,
  magAt,
  outsideZone,
  pickZone,
  rollLoot,
  startKit,
  swapGun,
  takeGrenades,
  takeGun,
  useGrenade,
  zoneAt,
  zoneDamage,
} from "../src/royale.ts";
import { MAPS } from "../src/maps/index.ts";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

// --- Ranking: order of knock-out, not kills ----------------------------------------

const st = (id: string, outTick: number, kills = 0, damage = 0): RoyaleStanding => ({ id, outTick, kills, damage });
const ids = (r: ReturnType<typeof rankRoyale>) => r.order.map((o) => o.entry.id).join(",");

// The survivor first, then the last one out... the first one out last, whatever the kills.
const byDeath = rankRoyale([st("early", 100, 5, 900), st("winner", 0, 0, 10), st("late", 400, 1), st("mid", 250, 3)], "m");
check(ids(byDeath) === "winner,late,mid,early" && byDeath.reason === "", `places follow the order of knock-out, not kills (${ids(byDeath)})`);
check(byDeath.order.map((o) => o.place).join() === "1,2,3,4", "every place is its own, 1 to n");

// Same tick: kills, then damage, then the lot.
const sameKills = rankRoyale([st("a", 300, 1, 50), st("b", 300, 2, 10), st("c", 100)], "m");
check(ids(sameKills) === "b,a,c" && sameKills.reason === "kills", `the last two out on the same tick: more kills wins (${ids(sameKills)}, "${sameKills.reason}")`);
const sameDamage = rankRoyale([st("a", 300, 2, 50), st("b", 300, 2, 80)], "m");
check(ids(sameDamage) === "b,a" && sameDamage.reason === "damage", `then more damage (${ids(sameDamage)}, "${sameDamage.reason}")`);
const tied = [st("a", 300), st("b", 300), st("c", 300)];
const lot = rankRoyale(tied, "room:m1");
const expected = [...tied].sort((x, y) => lotOf("room:m1", x.id) - lotOf("room:m1", y.id)).map((e) => e.id).join(",");
check(ids(lot) === expected && lot.reason === "lot", `then the lot, reproducible from the match id (${ids(lot)})`);
check(ids(rankRoyale([...tied].reverse(), "room:m1")) === ids(lot), "the lot doesn't depend on the input order");
// A tie lower down doesn't touch first place or the reason.
const lowTie = rankRoyale([st("w", 0), st("x", 200, 0), st("y", 200, 3)], "m");
check(ids(lowTie) === "w,y,x" && lowTie.reason === "", `a same-tick tie further down: split there, first won outright (${ids(lowTie)})`);
// A leaver is knocked out when they leave: no 1st place for leaving early.
const leaver = rankRoyale([st("left", 50, 4, 400), st("stayed", 0)], "m");
check(ids(leaver) === "stayed,left", "leaving early is a knock-out at that tick, not a win");
check(rankRoyale([], "m").order.length === 0, "nobody: an empty order");

// --- The zone --------------------------------------------------------------------------

const zone: ZoneView = { x0: 0, z0: 0, x1: 8, z1: -6, r0: 40, r1: 0, start: 900, end: 8100 };
const c0 = zoneAt(zone, 0)!;
const cStart = zoneAt(zone, zone.start)!;
const cMid = zoneAt(zone, (zone.start + zone.end) / 2)!;
const cEnd = zoneAt(zone, zone.end)!;
const cLate = zoneAt(zone, zone.end + 3000)!;
check(c0.r === 40 && cStart.r === 40 && c0.x === 0, "before it shrinks: the start circle");
check(Math.abs(cMid.r - 20) < 1e-9 && Math.abs(cMid.x - 4) < 1e-9 && Math.abs(cMid.z + 3) < 1e-9, `halfway: half the radius, halfway to the end centre (r ${cMid.r})`);
check(cEnd.r === 0 && cEnd.x === 8 && cEnd.z === -6 && cLate.r === 0, "closed at the end tick, and stays closed");
let smooth = true;
for (let t = zone.start; t < zone.end; t += 7) if (zoneAt(zone, t + 1)!.r > zoneAt(zone, t)!.r || zoneAt(zone, t)!.r - zoneAt(zone, t + 1)!.r > 0.01) smooth = false;
check(smooth, "it shrinks a little every tick, never grows, no steps");
check(zoneAt({ ...zone, end: 0 }, 5000) === null && !outsideZone({ ...zone, end: 0 }, 5000, 99, 99), "no zone (end 0): nobody is outside");
check(!outsideZone(zone, zone.end - 1, 8, -6) && outsideZone(zone, cMid ? (zone.start + zone.end) / 2 : 0, 30, 0), "inside is safe, outside isn't");
check(ROYALE_RULES.royale?.zoneClose === ZONE.close && ZONE.close <= 4.5 * 60 && ZONE.wait < ZONE.close, `the real zone closes by 4:30 (${ZONE.close} s)`);

// Damage outside: whole HP each tick, growing, summing to the dose.
const perSecond = (from: number) => {
  let n = 0;
  for (let t = from; t < from + TICK_RATE; t++) n += zoneDamage(zone, t);
  return n;
};
check(zoneDamage(zone, zone.start - 5) === 0 && perSecond(zone.start - TICK_RATE) === 0, "no damage before it shrinks");
const early = perSecond(zone.start + 1);
const mid = perSecond((zone.start + zone.end) / 2);
const late = perSecond(zone.end + 60);
check(early >= ZONE.dpsStart - 1 && early <= ZONE.dpsStart + 1, `about ${ZONE.dpsStart} HP a second at first (${early})`);
check(mid > early && late > mid, `it grows as the zone closes (${early}, ${mid}, ${late} per second)`);
check(Math.abs(late - ZONE.dpsEnd) <= 1, `about ${ZONE.dpsEnd} HP a second once closed (${late})`);
let integer = true;
for (let t = zone.start; t < zone.end + 300; t += 13) if (!Number.isInteger(zoneDamage(zone, t)) || zoneDamage(zone, t) < 0) integer = false;
check(integer, "every tick's damage is a whole, non-negative number");

// The zone of a real match: covers the map, closes on the drawn centre inside the limits.
for (const map of ROYALE_MAPS) {
  const z = pickZone(map, "room:abc", 100, 100 + ticks(ZONE.close));
  const lim = map.royale!.zone;
  check(z.r0 >= Math.hypot(map.halfX, map.halfZ), `${map.id}: the zone starts round the whole map (r ${z.r0.toFixed(1)})`);
  check(z.x1 >= lim.x0 && z.x1 <= lim.x1 && z.z1 >= lim.z0 && z.z1 <= lim.z1 && z.r1 === 0, `${map.id}: it closes on a centre inside its limits (${z.x1.toFixed(1)}, ${z.z1.toFixed(1)})`);
  const again = pickZone(map, "room:abc", 100, 200);
  const other = pickZone(map, "room:xyz", 100, 200);
  check(again.x1 === z.x1 && again.z1 === z.z1 && (other.x1 !== z.x1 || other.z1 !== z.z1), `${map.id}: the centre comes from the match seed`);
}

// --- Grenade stacks ------------------------------------------------------------------

const fragMax = GRENADES[GRENADE_FRAG].stack;
const none = takeGrenades({ type: GRENADE_FRAG, count: 0 }, { type: GRENADE_SMOKE, count: 1 });
check(none.held.type === GRENADE_SMOKE && none.held.count === 1 && none.left === 0 && none.dropped === null, "none held: the stack is taken");
const add = takeGrenades({ type: GRENADE_FRAG, count: 1 }, { type: GRENADE_FRAG, count: 1 });
check(add.held.count === 2 && add.left === 0 && add.dropped === null, "the same type adds to the stack");
const cap = takeGrenades({ type: GRENADE_FRAG, count: fragMax - 1 }, { type: GRENADE_FRAG, count: 2 });
check(cap.held.count === fragMax && cap.left === 1 && cap.taken === 1, `up to the type's maximum (${fragMax}); the rest stays on the floor`);
const full = takeGrenades({ type: GRENADE_FRAG, count: fragMax }, { type: GRENADE_FRAG, count: 2 });
check(full.taken === 0 && full.left === 2 && full.held.count === fragMax, "at the maximum: nothing is taken");
const swap = takeGrenades({ type: GRENADE_FRAG, count: 2 }, { type: GRENADE_SMOKE, count: 1 });
check(swap.held.type === GRENADE_SMOKE && swap.held.count === 1 && swap.dropped?.type === GRENADE_FRAG && swap.dropped.count === 2 && swap.left === 0, "another type swaps in, and the old stack drops");
check(useGrenade(2) === 1 && useGrenade(1) === 0 && useGrenade(0) === 0, "each throw uses one, never below 0");
check(GRENADES.every((g) => g.stack >= 1), "every grenade type has a stack of at least 1");

// --- Gun slots ------------------------------------------------------------------------

const RIFLE = 0;
const SMG = WEAPONS.findIndex((w) => w.key === "smg");
const SNIPER = WEAPONS.findIndex((w) => w.key === "sniper");
const DMR = WEAPONS.findIndex((w) => w.key === "dmr");
const start = spawnSim(0, 0, RIFLE, undefined, startKit());
check(gunInHand(start.kit) === PISTOL && start.ammo === WEAPONS[PISTOL].magazine && gunAt(start.kit, 1) === NO_GUN, "the start: the Pistol in slot 1, in hand, full; slots 2-3 empty");
check(WEAPONS[PISTOL].pickable === false, "the Pistol is a starting gun only (pickable: false)");

const one = takeGun(start, RIFLE, 7)!;
check(!!one && gunAt(one.kit, 1) === RIFLE && one.kit.mag1 === 7 && gunInHand(one.kit) === PISTOL, "a gun fills the first free slot, with its magazine; the one in hand stays");
check(takeGun(one, RIFLE, 12) === null, "a gun already carried stays on the floor");
const two = takeGun(one, SMG, 30)!;
check(freeGunSlot(two.kit) === -1 && takeGun(two, SNIPER, 4) === null, "with 3 guns, walking over another does nothing");

// Switching through the step: each gun keeps its magazine, the switch cancels a reload.
const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0, slot: 0, switch: 0, swap: 0 };
const can = playerCan(true, "playing");
let seq = 0;
const step = (s: PlayerSim, extra: Partial<InputMessage>) => stepPlayer(open, s, { ...idle, seq: ++seq, ...extra }, RIFLE, can, GRENADE_FRAG, "slots");
const open = { halfX: 20, halfZ: 20, obstacles: [] };
let s = { ...two, ammo: 4 }; // 4 left in the Pistol
let r = step(s, { slot: 1, switch: 1 });
s = r.sim;
check(gunInHand(s.kit) === RIFLE && s.ammo === 7 && magAt(s, 0) === 4, `switch to slot 2: the rifle's 7 in hand, the Pistol keeps its 4 (${s.ammo}, ${magAt(s, 0)})`);
const delay = ticks(ROYALE.switchTime);
let fired = -1;
for (let i = 0; i < delay + 3 && fired < 0; i++) {
  r = step(s, { fire: true, switch: 1, slot: 1 });
  s = r.sim;
  if (r.fired) fired = i + 1;
}
check(fired === delay, `a switch waits ${ROYALE.switchTime} s (${delay} steps) before it can fire (fired on step ${fired})`);
check(s.ammo === 6, "the shot came out of the rifle's magazine");
r = step(s, { reload: 1, switch: 1, slot: 1 });
s = r.sim;
check(s.reloadTicks > 0, "a reload starts");
r = step(s, { reload: 1, switch: 2, slot: 2 });
s = r.sim;
check(gunInHand(s.kit) === SMG && s.reloadTicks === 0 && s.ammo === 30 && magAt(s, 1) === 6, "switching away mid-reload cancels it: the rifle keeps 6, the SMG's 30 in hand");
r = step(s, { reload: 1, switch: 3, slot: 1 });
s = r.sim;
check(gunInHand(s.kit) === RIFLE && s.ammo === 6, "and back: the rifle's magazine as it was (not refilled)");
const same = step(s, { reload: 1, switch: 4, slot: 1 }).sim;
check(same.fireCd <= s.fireCd, "asking for the slot in hand does nothing");
const toEmpty = stepPlayer(open, { ...one, kit: { ...one.kit } }, { ...idle, seq: 999, switch: 1, slot: 2 }, RIFLE, can, GRENADE_FRAG, "slots").sim;
check(gunInHand(toEmpty.kit) === PISTOL, "an empty slot can't be switched to");
const dead = stepPlayer(open, two, { ...idle, seq: 1000, switch: 1, slot: 1 }, RIFLE, playerCan(false, "playing"), GRENADE_FRAG, "slots").sim;
check(gunInHand(dead.kit) === PISTOL && dead.kit.switchSeen === 1, "dead: the press is used up and nothing switches");
const loadout = stepPlayer(open, two, { ...idle, seq: 1001, switch: 1, slot: 1 }, RIFLE, can).sim;
check(gunInHand(loadout.kit) === PISTOL, "the other modes (loadout): the switch press does nothing");

// The wheel: carried slots only.
check(cycleSlot(two.kit, 1) === 1 && cycleSlot({ ...two.kit, hand: 2 }, 1) === 0 && cycleSlot(two.kit, -1) === 2, "the wheel cycles through carried guns");
check(cycleSlot({ ...one.kit, hand: 1 }, 1) === 0 && cycleSlot(start.kit, 1) === 0, "skipping empty slots (alone: stays)");

// F swap: the floor gun takes the hand's place, the old one drops with its magazine.
const held = { ...s }; // rifle in hand with 6
const sw = swapGun(held, SNIPER, 3)!;
check(!!sw && gunInHand(sw.sim.kit) === SNIPER && sw.sim.ammo === 3 && sw.dropped.weapon === RIFLE && sw.dropped.mag === 6, "F swaps the floor gun into the hand; the old one drops, magazine as it was");
check(sw.sim.fireCd >= delay && carriedGuns(sw.sim).length === 3, "the swapped-in gun waits the switch delay too; still 3 guns");
check(swapGun(held, SMG, 30) === null, "F on a gun already carried does nothing");
check(takeGun(sw.sim, DMR, 8) === null, "still full after a swap");

// Counted grenades in the step (royale) against the cooldown (the other modes).
const withTwo = { ...start, kit: { ...start.kit, grenades: 2 } };
let g = stepPlayer(open, withTwo, { ...idle, seq: 1, grenade: 1, gx: 3 }, RIFLE, can, GRENADE_FRAG, "slots");
check(!!g.grenade && g.sim.kit.grenades === 1 && g.sim.grenadeCd === ticks(ROYALE.throwGap), "a throw uses one grenade, and a short gap follows");
g = stepPlayer(open, g.sim, { ...idle, seq: 2, grenade: 2, gx: 3 }, RIFLE, can, GRENADE_FRAG, "slots");
check(!g.grenade && g.sim.kit.grenades === 1, "no second throw inside the gap");
let empty = { ...start, kit: { ...start.kit, grenades: 0 } };
const none0 = stepPlayer(open, empty, { ...idle, seq: 3, grenade: 1, gx: 3 }, RIFLE, can, GRENADE_FRAG, "slots");
check(!none0.grenade, "with 0 grenades, nothing to throw");
empty = spawnSim(0, 0, RIFLE);
const cooled = stepPlayer(open, empty, { ...idle, seq: 1, grenade: 1, gx: 3 }, RIFLE, can, GRENADE_FRAG);
check(!!cooled.grenade && cooled.sim.kit.grenades === 0 && cooled.sim.grenadeCd === ticks(GRENADES[GRENADE_FRAG].cooldown), "the other modes keep the grenade on its cooldown, uncounted");

// --- Loot ------------------------------------------------------------------------------

const draws = new Map<string, number>();
for (let i = 0; i < 1000; i++) {
  const d = rollLoot((i + 0.5) / 1000);
  const key = `${d.kind}:${d.item}`;
  draws.set(key, (draws.get(key) ?? 0) + 1);
  if (d.item < 0 || d.amount < 1) failures.push(`loot ${key} is valid`);
}
check(draws.size === LOOT.length, `every loot line can drop (${draws.size} of ${LOOT.length})`);
check(LOOT.every((e) => e.kind !== "gun" || WEAPONS.some((w) => w.key === e.key && w.key !== "pistol")), "the loot names real guns, never the Pistol");
check(LOOT.every((e) => e.kind !== "grenade" || e.amount <= GRENADES.find((x) => x.key === e.key)!.stack), "no loot stack is over its type's maximum");

// --- Maps: crate spots ------------------------------------------------------------------

check(ROYALE_MAPS.length >= 1 && ROYALE_MAPS.every((m) => !MAPS.includes(m)), `royale maps: ${ROYALE_MAPS.map((m) => m.id).join(", ")} (never a duel map)`);
for (const map of ROYALE_MAPS) {
  const crates = map.royale!.crates;
  const inside = crates.every((c) => Math.abs(c.x) <= map.halfX - 1 && Math.abs(c.z) <= map.halfZ - 1);
  const clear = crates.every((c) => !map.obstacles.some((b) => circleOverlapsBox(c.x, c.z, ROYALE.crateRadius + PLAYER_RADIUS, b)));
  const far = Math.min(...crates.flatMap((c) => map.spawns.map((sp) => Math.hypot(sp.x - c.x, sp.z - c.z))));
  check(crates.length >= 10 && inside && clear, `${map.id}: ${crates.length} crates on open floor, inside the walls`);
  check(far >= 3, `${map.id}: no crate within 3 m of a spawn (closest ${far.toFixed(1)} m)`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nroyale: all checks passed");
