// Self-check of the battle royale's healing items and shield charges
// (royale.ts "Healing", run by the step in combat.ts): a heal completes, is
// capped at MAX_HP, slows its user, is cancelled by a shot, a throw, a switch
// or damage (the item kept), the same-tick order (a heal due completes
// first), the stacks' limits, the shield charges (use, none left, the wait
// between two), and the other modes left as they were.
// Run with `bun run check` (in packages/shared). Exits non-zero on a failure.

import { playerCan, spawnSim, stepPlayer } from "../src/combat.ts";
import {
  GRENADE_FRAG,
  HEAL_BANDAGE,
  HEAL_ITEMS,
  HEAL_MEDKIT,
  ITEM_HEAL,
  ITEM_SHIELD,
  LOOT,
  MAX_HP,
  NO_HEAL,
  PLAYER_SPEED,
  ROYALE,
  SHIELD_CHARGE_TICKS,
  SHIELD_COOLDOWN_TICKS,
  SHIELD_TICKS,
  TICK_DT,
  WEAPONS,
  ticks,
} from "../src/constants.ts";
import { parseInput } from "../src/messages.ts";
import type { InputMessage, PlayerSim } from "../src/protocol.ts";
import { HEAL_STOP, cancelHeal, carriedStacks, lootItem, stackMax, startKit, takeStack } from "../src/royale.ts";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

const RIFLE = WEAPONS.findIndex((w) => w.key === "rifle");
const open = { halfX: 40, halfZ: 40, obstacles: [] };
const can = playerCan(true, "playing");
const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0, slot: 0, switch: 0, swap: 0, heal: 0, use: 0 };
let seq = 0;
/** One royale step with these input fields (the counters are running totals: pass them as they are). */
const step = (s: PlayerSim, extra: Partial<InputMessage> = {}, c = can) => stepPlayer(open, s, { ...idle, seq: ++seq, ...extra }, RIFLE, c, GRENADE_FRAG, "slots");

/** A royale player at (0, 0) with `hp`, carrying what `kit` says. */
function player(hp: number, kit: Partial<PlayerSim["kit"]> = {}): PlayerSim {
  const s = spawnSim(0, 0, RIFLE, undefined, startKit());
  return { ...s, hp, kit: { ...s.kit, ...kit } };
}

/** Steps with the same input until the heal is over (or `max` steps). Returns the steps taken and the last result. */
function runHeal(s: PlayerSim, extra: Partial<InputMessage>, max = 400) {
  let r = step(s, extra);
  let n = 1;
  while (r.sim.kit.heal !== NO_HEAL && n < max) {
    r = step(r.sim, extra);
    n++;
  }
  return { n, r };
}

const bandage = HEAL_ITEMS[HEAL_BANDAGE];
const medkit = HEAL_ITEMS[HEAL_MEDKIT];

// --- The definitions ------------------------------------------------------------------

check(bandage.amount === 25 && bandage.duration === 1.5 && bandage.stack === 5, "the bandage: 25 HP in 1.5 s, up to 5");
check(medkit.amount >= MAX_HP && medkit.duration === 4 && medkit.stack === 2, "the medkit: back to full in 4 s, up to 2");
check(ROYALE.shieldStack === 3 && ROYALE.healSpeedScale === 0.5, "up to 3 shield charges; half speed while healing");
const weight = (kind: string, key?: string) => LOOT.filter((e) => e.kind === kind && (!key || ("key" in e && e.key === key))).reduce((n, e) => n + e.weight, 0);
check(weight("heal", "bandage") > weight("heal", "medkit") && weight("heal", "medkit") > 0, "crates drop bandages more often than medkits (both do)");
check(weight("shield") > 0, "crates drop shield charges");
const drop = lootItem({ weight: 1, kind: "heal", key: "medkit", amount: 1 });
check(drop.kind === ITEM_HEAL && drop.item === HEAL_MEDKIT && drop.amount === 1, "a medkit line drops a medkit");
check(lootItem({ weight: 1, kind: "shield", amount: 2 }).kind === ITEM_SHIELD, "a shield line drops shield charges");

// --- A heal that completes -------------------------------------------------------------

const hurt = player(50, { bandages: 2 });
const started = step(hurt, { use: 1, heal: HEAL_BANDAGE });
check(started.healStart && started.sim.kit.heal === HEAL_BANDAGE && started.sim.hp === 50, "4 starts a bandage (nothing healed yet)");
const { n: bandageSteps, r: bandageDone } = runHeal(started.sim, { use: 1, heal: HEAL_BANDAGE });
check(bandageSteps === ticks(bandage.duration), `it completes ${ticks(bandage.duration)} steps after the press (${bandageSteps})`);
check(bandageDone.sim.hp === 75 && bandageDone.healed === 25, `a completed bandage heals 25 (${bandageDone.sim.hp})`);
check(bandageDone.sim.kit.bandages === 1, "and only then is it used up");
check(bandageDone.sim.kit.heal === NO_HEAL && bandageDone.sim.kit.healStop === HEAL_STOP.done, "the heal is over, and says it completed");
const again = runHeal(bandageDone.sim, { use: 1, heal: HEAL_BANDAGE });
check(again.r.sim.hp === 75 && again.r.healed === 0, "one press is one heal: holding nothing new starts no second one");

const low = player(10, { medkits: 1 });
const kit1 = runHeal(step(low, { use: 1, heal: HEAL_MEDKIT }).sim, { use: 1, heal: HEAL_MEDKIT });
check(kit1.r.sim.hp === MAX_HP && kit1.r.sim.kit.medkits === 0, `a medkit heals back to full (${kit1.r.sim.hp})`);
const nearlyFull = player(90, { bandages: 1 });
const capped = runHeal(step(nearlyFull, { use: 1, heal: HEAL_BANDAGE }).sim, { use: 1, heal: HEAL_BANDAGE });
check(capped.r.sim.hp === MAX_HP && capped.r.healed === 10, `health never goes over ${MAX_HP} (${capped.r.sim.hp}, +${capped.r.healed})`);

// --- When a heal can't start ----------------------------------------------------------

check(!step(player(MAX_HP, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE }).healStart, "not at full health");
check(!step(player(50), { use: 1, heal: HEAL_BANDAGE }).healStart, "not with none left");
check(!step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_MEDKIT }).healStart, "not with none of that item (a bandage isn't a medkit)");
check(!step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE, fire: true }).healStart, "not with the trigger held");
check(!step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE }, playerCan(true, "warmup")).healStart, "not in warmup");
const used = step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE }, playerCan(false, "playing"));
check(!used.healStart && used.sim.kit.useSeen === 1, "not while dead, and the press is used up");
const inOther = stepPlayer(open, player(50, { bandages: 1 }), { ...idle, seq: ++seq, use: 1, heal: HEAL_BANDAGE }, RIFLE, can);
check(!inOther.healStart && inOther.sim.kit.heal === NO_HEAL, "the other modes (loadout): no healing at all");
const busy = step(started.sim, { use: 2, heal: HEAL_MEDKIT });
check(busy.sim.kit.heal === HEAL_BANDAGE, "a second press mid-heal changes nothing");

// --- While healing: half speed, no dash ------------------------------------------------

const walking = step(started.sim, { use: 1, heal: HEAL_BANDAGE, mx: 1 });
const walkFree = step(player(50), { mx: 1 });
const slow = walking.sim.x - started.sim.x;
const full = walkFree.sim.x;
check(Math.abs(slow - PLAYER_SPEED * TICK_DT * ROYALE.healSpeedScale) < 1e-9 && Math.abs(full - PLAYER_SPEED * TICK_DT) < 1e-9, `half speed while healing (${slow.toFixed(3)} against ${full.toFixed(3)} m a step)`);
const startMoving = step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE, mx: 1 });
check(Math.abs(startMoving.sim.x - PLAYER_SPEED * TICK_DT * ROYALE.healSpeedScale) < 1e-9, "from the very step it starts on");
const dashed = step(started.sim, { use: 1, heal: HEAL_BANDAGE, dash: 1, mx: 1 });
check(!dashed.dashing && dashed.sim.kit.heal === HEAL_BANDAGE && dashed.sim.dashCd === 0, "no dash while healing (the press is used up, the heal goes on)");

// --- What cancels it (nothing healed, the item kept) -------------------------------------

const midway = step(step(started.sim, { use: 1, heal: HEAL_BANDAGE }).sim, { use: 1, heal: HEAL_BANDAGE }).sim;
const fired = step(midway, { use: 1, heal: HEAL_BANDAGE, fire: true });
check(fired.fired && fired.sim.kit.heal === NO_HEAL && fired.sim.kit.healStop === HEAL_STOP.fire, "firing cancels it (and the shot goes)");
check(fired.sim.hp === 50 && fired.sim.kit.bandages === 2, "a cancelled heal heals nothing and keeps the item");
const withNade = { ...midway, kit: { ...midway.kit, grenades: 1 } };
const thrown = step(withNade, { use: 1, heal: HEAL_BANDAGE, grenade: 1, gx: 3 });
check(!!thrown.grenade && thrown.sim.kit.healStop === HEAL_STOP.throw && thrown.sim.kit.bandages === 2, "throwing cancels it");
const noNade = step(midway, { use: 1, heal: HEAL_BANDAGE, grenade: 1, gx: 3 });
check(!noNade.grenade && noNade.sim.kit.heal === HEAL_BANDAGE, "Q with no grenade throws nothing, and cancels nothing");
const withRifle = { ...midway, kit: { ...midway.kit, gun1: RIFLE, mag1: WEAPONS[RIFLE].magazine } };
const switched = step(withRifle, { use: 1, heal: HEAL_BANDAGE, switch: 1, slot: 1 });
check(switched.sim.kit.hand === 1 && switched.sim.kit.healStop === HEAL_STOP.switch && switched.sim.kit.bandages === 2, "switching guns cancels it");
const shielded = step({ ...midway, kit: { ...midway.kit, shields: 1 } }, { use: 1, heal: HEAL_BANDAGE, shield: 1 });
check(shielded.shield && shielded.sim.kit.heal === HEAL_BANDAGE, "raising the shield doesn't cancel it");
// Damage is the server's: it calls cancelHeal with why, on the synced kit.
const hit = { ...midway, kit: { ...midway.kit } };
check(cancelHeal(hit.kit, HEAL_STOP.hurt) && hit.kit.heal === NO_HEAL && hit.kit.bandages === 2 && hit.kit.healStop === HEAL_STOP.hurt, "damage cancels it, the item kept");
const zoned = { ...midway, kit: { ...midway.kit } };
cancelHeal(zoned.kit, HEAL_STOP.zone);
check(zoned.kit.healStop === HEAL_STOP.zone, "the zone's damage too, and says so");
const afterHit = runHeal(hit, { use: 1, heal: HEAL_BANDAGE });
check(afterHit.r.sim.hp === 50 && afterHit.r.sim.kit.bandages === 2, "nothing comes of a cancelled heal later");
const restart = step(hit, { use: 2, heal: HEAL_BANDAGE });
check(restart.healStart && restart.sim.kit.healTicks === ticks(bandage.duration), "a new press starts it again, from the beginning");

// --- The same tick: the heal due completes first ---------------------------------------

let due = started.sim;
while (due.kit.healTicks > 1) due = step(due, { use: 1, heal: HEAL_BANDAGE }).sim;
const lastStep = step(due, { use: 1, heal: HEAL_BANDAGE, fire: true });
check(lastStep.healed === 25 && lastStep.fired && lastStep.sim.kit.healStop === HEAL_STOP.done, "a shot on the step it completes: healed first, then the shot, nothing cancelled");
// The server applies inputs before damage: the completed heal is gone, so damage finds nothing to cancel.
const damaged = { ...lastStep.sim, kit: { ...lastStep.sim.kit } };
check(!cancelHeal(damaged.kit, HEAL_STOP.hurt) && damaged.kit.bandages === 1 && damaged.kit.healStop === HEAL_STOP.done, "damage the same tick after it completed: no double heal, used up once");

// --- Stacks -----------------------------------------------------------------------------

const b = takeStack(4, stackMax(ITEM_HEAL, HEAL_BANDAGE), 3);
check(b.have === 5 && b.left === 2 && b.taken === 1, "bandages stack up to 5, the rest stays on the floor");
check(takeStack(5, stackMax(ITEM_HEAL, HEAL_BANDAGE), 2).taken === 0, "at 5 bandages, nothing is taken");
const m = takeStack(0, stackMax(ITEM_HEAL, HEAL_MEDKIT), 3);
check(m.have === 2 && m.left === 1, "medkits up to 2");
const sh = takeStack(2, stackMax(ITEM_SHIELD, 0), 2);
check(sh.have === 3 && sh.left === 1, "shield charges up to 3");
const drops = carriedStacks({ ...startKit(), bandages: 3, medkits: 1, shields: 2 });
check(drops.length === 3 && drops.map((d) => d.amount).join() === "3,1,2", "a knock-out drops each stack carried");
check(carriedStacks(startKit()).length === 0, "nothing carried, nothing dropped");

// --- Shield charges ---------------------------------------------------------------------

const none = step(player(MAX_HP), { shield: 1 });
check(!none.shield && none.sim.shieldCd === 0, "in royale you start with no charge, and E does nothing then");
let sc = step(player(MAX_HP, { shields: 2 }), { shield: 1 });
check(sc.shield && sc.sim.kit.shields === 1 && sc.sim.shieldCd === SHIELD_CHARGE_TICKS, "E uses one charge");
check(SHIELD_CHARGE_TICKS > SHIELD_TICKS && SHIELD_CHARGE_TICKS - SHIELD_TICKS === ticks(ROYALE.shieldGap), "the next can't go up before this bubble ends plus the gap: no chaining");
let shieldSeen = 1;
let waited = 0;
let second = sc;
while (waited < SHIELD_CHARGE_TICKS + 5) {
  second = step(second.sim, { shield: ++shieldSeen });
  waited++;
  if (second.shield) break;
}
check(second.shield && waited === SHIELD_CHARGE_TICKS && second.sim.kit.shields === 0, `the second one only after the wait (${waited} steps)`);
sc = step(second.sim, { shield: ++shieldSeen });
for (let i = 0; i < SHIELD_CHARGE_TICKS + 2; i++) sc = step(sc.sim, { shield: ++shieldSeen });
check(!sc.shield && sc.sim.kit.shields === 0, "with none left, E does nothing");
const other = stepPlayer(open, player(MAX_HP), { ...idle, seq: ++seq, shield: 1 }, RIFLE, can);
check(other.shield && other.sim.shieldCd === SHIELD_COOLDOWN_TICKS, "the other modes keep the shield on its cooldown, no charge needed");

// --- The input ----------------------------------------------------------------------------

const base = { seq: 1, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
check(parseInput(base)?.heal === 0 && parseInput(base)?.use === 0, "heal and use read as 0 when missing");
check(parseInput({ ...base, heal: HEAL_MEDKIT, use: 3 })?.heal === HEAL_MEDKIT, "a medkit use is a valid input");
check(parseInput({ ...base, heal: 2 }) === null && parseInput({ ...base, use: -1 }) === null, "an unknown item or a bad counter is refused");

if (failures.length > 0) {
  console.error(`\n${failures.length} heal check(s) failed`);
  process.exit(1);
}
console.log("\nall heal checks passed");
