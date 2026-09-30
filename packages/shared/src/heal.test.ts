// Tests of the battle royale's healing items and shield charges (royale.ts
// "Healing", run by the step in combat.ts): a heal completes, is capped at
// MAX_HP, slows its user, is cancelled by a shot, a throw, a switch or damage
// (the item kept), the same-tick order (a heal due completes first), the
// stacks' limits, the shield charges (use, none left, the wait between two),
// and the other modes left as they were.
// Run with `bun run test` (or `bun test src/heal.test.ts` in packages/shared).
//
// The steps run in order in the describe bodies (the input seq counts up
// across them, and cancelHeal changes the kit it is given), and each test
// only asserts on their results.

import { describe, expect, test } from "bun:test";
import { playerCan, spawnSim, stepPlayer } from "./combat.ts";
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
} from "./constants.ts";
import { parseInput } from "./messages.ts";
import type { InputMessage, PlayerSim } from "./protocol.ts";
import { HEAL_STOP, cancelHeal, carriedStacks, lootItem, stackMax, startKit, takeStack } from "./royale.ts";

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

describe("the definitions", () => {
  test("the bandage: 25 HP in 1.5 s, up to 5", () => {
    expect([bandage.amount, bandage.duration, bandage.stack]).toEqual([25, 1.5, 5]);
  });
  test("the medkit: back to full in 4 s, up to 2", () => {
    expect(medkit.amount).toBeGreaterThanOrEqual(MAX_HP);
    expect([medkit.duration, medkit.stack]).toEqual([4, 2]);
  });
  test("up to 3 shield charges; half speed while healing", () => {
    expect(ROYALE.shieldStack).toBe(3);
    expect(ROYALE.healSpeedScale).toBe(0.5);
  });
  const weight = (kind: string, key?: string) => LOOT.filter((e) => e.kind === kind && (!key || ("key" in e && e.key === key))).reduce((n, e) => n + e.weight, 0);
  test("crates drop bandages more often than medkits (both do)", () => {
    expect(weight("heal", "bandage")).toBeGreaterThan(weight("heal", "medkit"));
    expect(weight("heal", "medkit")).toBeGreaterThan(0);
  });
  test("crates drop shield charges", () => {
    expect(weight("shield")).toBeGreaterThan(0);
  });
  test("a medkit line drops a medkit", () => {
    const drop = lootItem({ weight: 1, kind: "heal", key: "medkit", amount: 1 });
    expect(drop.kind).toBe(ITEM_HEAL);
    expect(drop.item).toBe(HEAL_MEDKIT);
    expect(drop.amount).toBe(1);
  });
  test("a shield line drops shield charges", () => {
    expect(lootItem({ weight: 1, kind: "shield", amount: 2 }).kind).toBe(ITEM_SHIELD);
  });
});

// Shared with the later sections: the bandage started here.
const hurt = player(50, { bandages: 2 });
const started = step(hurt, { use: 1, heal: HEAL_BANDAGE });

describe("a heal that completes", () => {
  test("4 starts a bandage (nothing healed yet)", () => {
    expect(started.healStart).toBe(true);
    expect(started.sim.kit.heal).toBe(HEAL_BANDAGE);
    expect(started.sim.hp).toBe(50);
  });
  const { n: bandageSteps, r: bandageDone } = runHeal(started.sim, { use: 1, heal: HEAL_BANDAGE });
  test(`it completes ${ticks(bandage.duration)} steps after the press (${bandageSteps})`, () => {
    expect(bandageSteps).toBe(ticks(bandage.duration));
  });
  test(`a completed bandage heals 25 (${bandageDone.sim.hp})`, () => {
    expect(bandageDone.sim.hp).toBe(75);
    expect(bandageDone.healed).toBe(25);
  });
  test("and only then is it used up", () => {
    expect(bandageDone.sim.kit.bandages).toBe(1);
  });
  test("the heal is over, and says it completed", () => {
    expect(bandageDone.sim.kit.heal).toBe(NO_HEAL);
    expect(bandageDone.sim.kit.healStop).toBe(HEAL_STOP.done);
  });
  const again = runHeal(bandageDone.sim, { use: 1, heal: HEAL_BANDAGE });
  test("one press is one heal: holding nothing new starts no second one", () => {
    expect(again.r.sim.hp).toBe(75);
    expect(again.r.healed).toBe(0);
  });

  const low = player(10, { medkits: 1 });
  const kit1 = runHeal(step(low, { use: 1, heal: HEAL_MEDKIT }).sim, { use: 1, heal: HEAL_MEDKIT });
  test(`a medkit heals back to full (${kit1.r.sim.hp})`, () => {
    expect(kit1.r.sim.hp).toBe(MAX_HP);
    expect(kit1.r.sim.kit.medkits).toBe(0);
  });
  const nearlyFull = player(90, { bandages: 1 });
  const capped = runHeal(step(nearlyFull, { use: 1, heal: HEAL_BANDAGE }).sim, { use: 1, heal: HEAL_BANDAGE });
  test(`health never goes over ${MAX_HP} (${capped.r.sim.hp}, +${capped.r.healed})`, () => {
    expect(capped.r.sim.hp).toBe(MAX_HP);
    expect(capped.r.healed).toBe(10);
  });
});

describe("when a heal can't start", () => {
  const atFull = step(player(MAX_HP, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE });
  test("not at full health", () => {
    expect(atFull.healStart).toBe(false);
  });
  const noneLeft = step(player(50), { use: 1, heal: HEAL_BANDAGE });
  test("not with none left", () => {
    expect(noneLeft.healStart).toBe(false);
  });
  const wrongItem = step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_MEDKIT });
  test("not with none of that item (a bandage isn't a medkit)", () => {
    expect(wrongItem.healStart).toBe(false);
  });
  const trigger = step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE, fire: true });
  test("not with the trigger held", () => {
    expect(trigger.healStart).toBe(false);
  });
  const warmup = step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE }, playerCan(true, "warmup"));
  test("not in warmup", () => {
    expect(warmup.healStart).toBe(false);
  });
  const used = step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE }, playerCan(false, "playing"));
  test("not while dead, and the press is used up", () => {
    expect(used.healStart).toBe(false);
    expect(used.sim.kit.useSeen).toBe(1);
  });
  const inOther = stepPlayer(open, player(50, { bandages: 1 }), { ...idle, seq: ++seq, use: 1, heal: HEAL_BANDAGE }, RIFLE, can);
  test("the other modes (loadout): no healing at all", () => {
    expect(inOther.healStart).toBe(false);
    expect(inOther.sim.kit.heal).toBe(NO_HEAL);
  });
  const busy = step(started.sim, { use: 2, heal: HEAL_MEDKIT });
  test("a second press mid-heal changes nothing", () => {
    expect(busy.sim.kit.heal).toBe(HEAL_BANDAGE);
  });
});

describe("while healing: half speed, no dash", () => {
  const walking = step(started.sim, { use: 1, heal: HEAL_BANDAGE, mx: 1 });
  const walkFree = step(player(50), { mx: 1 });
  const slow = walking.sim.x - started.sim.x;
  const full = walkFree.sim.x;
  test(`half speed while healing (${slow.toFixed(3)} against ${full.toFixed(3)} m a step)`, () => {
    expect(slow).toBeCloseTo(PLAYER_SPEED * TICK_DT * ROYALE.healSpeedScale, 9);
    expect(full).toBeCloseTo(PLAYER_SPEED * TICK_DT, 9);
  });
  const startMoving = step(player(50, { bandages: 1 }), { use: 1, heal: HEAL_BANDAGE, mx: 1 });
  test("from the very step it starts on", () => {
    expect(startMoving.sim.x).toBeCloseTo(PLAYER_SPEED * TICK_DT * ROYALE.healSpeedScale, 9);
  });
  const dashed = step(started.sim, { use: 1, heal: HEAL_BANDAGE, dash: 1, mx: 1 });
  test("no dash while healing (the press is used up, the heal goes on)", () => {
    expect(dashed.dashing).toBe(false);
    expect(dashed.sim.kit.heal).toBe(HEAL_BANDAGE);
    expect(dashed.sim.dashCd).toBe(0);
  });
});

describe("what cancels it (nothing healed, the item kept)", () => {
  const midway = step(step(started.sim, { use: 1, heal: HEAL_BANDAGE }).sim, { use: 1, heal: HEAL_BANDAGE }).sim;
  const fired = step(midway, { use: 1, heal: HEAL_BANDAGE, fire: true });
  test("firing cancels it (and the shot goes)", () => {
    expect(fired.fired).toBe(true);
    expect(fired.sim.kit.heal).toBe(NO_HEAL);
    expect(fired.sim.kit.healStop).toBe(HEAL_STOP.fire);
  });
  test("a cancelled heal heals nothing and keeps the item", () => {
    expect(fired.sim.hp).toBe(50);
    expect(fired.sim.kit.bandages).toBe(2);
  });
  const withNade = { ...midway, kit: { ...midway.kit, grenades: 1 } };
  const thrown = step(withNade, { use: 1, heal: HEAL_BANDAGE, grenade: 1, gx: 3 });
  test("throwing cancels it", () => {
    expect(thrown.grenade).toBeTruthy();
    expect(thrown.sim.kit.healStop).toBe(HEAL_STOP.throw);
    expect(thrown.sim.kit.bandages).toBe(2);
  });
  const noNade = step(midway, { use: 1, heal: HEAL_BANDAGE, grenade: 1, gx: 3 });
  test("Q with no grenade throws nothing, and cancels nothing", () => {
    expect(noNade.grenade).toBeFalsy();
    expect(noNade.sim.kit.heal).toBe(HEAL_BANDAGE);
  });
  const withRifle = { ...midway, kit: { ...midway.kit, gun1: RIFLE, mag1: WEAPONS[RIFLE].magazine } };
  const switched = step(withRifle, { use: 1, heal: HEAL_BANDAGE, switch: 1, slot: 1 });
  test("switching guns cancels it", () => {
    expect(switched.sim.kit.hand).toBe(1);
    expect(switched.sim.kit.healStop).toBe(HEAL_STOP.switch);
    expect(switched.sim.kit.bandages).toBe(2);
  });
  const shielded = step({ ...midway, kit: { ...midway.kit, shields: 1 } }, { use: 1, heal: HEAL_BANDAGE, shield: 1 });
  test("raising the shield doesn't cancel it", () => {
    expect(shielded.shield).toBe(true);
    expect(shielded.sim.kit.heal).toBe(HEAL_BANDAGE);
  });
  // Damage is the server's: it calls cancelHeal with why, on the synced kit.
  const hit = { ...midway, kit: { ...midway.kit } };
  const hitCancelled = cancelHeal(hit.kit, HEAL_STOP.hurt);
  const hitKit = { ...hit.kit };
  test("damage cancels it, the item kept", () => {
    expect(hitCancelled).toBe(true);
    expect(hitKit.heal).toBe(NO_HEAL);
    expect(hitKit.bandages).toBe(2);
    expect(hitKit.healStop).toBe(HEAL_STOP.hurt);
  });
  const zoned = { ...midway, kit: { ...midway.kit } };
  cancelHeal(zoned.kit, HEAL_STOP.zone);
  test("the zone's damage too, and says so", () => {
    expect(zoned.kit.healStop).toBe(HEAL_STOP.zone);
  });
  const afterHit = runHeal(hit, { use: 1, heal: HEAL_BANDAGE });
  test("nothing comes of a cancelled heal later", () => {
    expect(afterHit.r.sim.hp).toBe(50);
    expect(afterHit.r.sim.kit.bandages).toBe(2);
  });
  const restart = step(hit, { use: 2, heal: HEAL_BANDAGE });
  test("a new press starts it again, from the beginning", () => {
    expect(restart.healStart).toBe(true);
    expect(restart.sim.kit.healTicks).toBe(ticks(bandage.duration));
  });
});

describe("the same tick: the heal due completes first", () => {
  let due = started.sim;
  while (due.kit.healTicks > 1) due = step(due, { use: 1, heal: HEAL_BANDAGE }).sim;
  const lastStep = step(due, { use: 1, heal: HEAL_BANDAGE, fire: true });
  test("a shot on the step it completes: healed first, then the shot, nothing cancelled", () => {
    expect(lastStep.healed).toBe(25);
    expect(lastStep.fired).toBe(true);
    expect(lastStep.sim.kit.healStop).toBe(HEAL_STOP.done);
  });
  // The server applies inputs before damage: the completed heal is gone, so damage finds nothing to cancel.
  const damaged = { ...lastStep.sim, kit: { ...lastStep.sim.kit } };
  const damagedCancelled = cancelHeal(damaged.kit, HEAL_STOP.hurt);
  test("damage the same tick after it completed: no double heal, used up once", () => {
    expect(damagedCancelled).toBe(false);
    expect(damaged.kit.bandages).toBe(1);
    expect(damaged.kit.healStop).toBe(HEAL_STOP.done);
  });
});

describe("stacks", () => {
  test("bandages stack up to 5, the rest stays on the floor", () => {
    expect(takeStack(4, stackMax(ITEM_HEAL, HEAL_BANDAGE), 3)).toEqual({ have: 5, left: 2, taken: 1 });
  });
  test("at 5 bandages, nothing is taken", () => {
    expect(takeStack(5, stackMax(ITEM_HEAL, HEAL_BANDAGE), 2).taken).toBe(0);
  });
  test("medkits up to 2", () => {
    const m = takeStack(0, stackMax(ITEM_HEAL, HEAL_MEDKIT), 3);
    expect(m.have).toBe(2);
    expect(m.left).toBe(1);
  });
  test("shield charges up to 3", () => {
    const sh = takeStack(2, stackMax(ITEM_SHIELD, 0), 2);
    expect(sh.have).toBe(3);
    expect(sh.left).toBe(1);
  });
  test("a knock-out drops each stack carried", () => {
    const drops = carriedStacks({ ...startKit(), bandages: 3, medkits: 1, shields: 2 });
    expect(drops.map((d) => d.amount)).toEqual([3, 1, 2]);
  });
  test("nothing carried, nothing dropped", () => {
    expect(carriedStacks(startKit())).toHaveLength(0);
  });
});

describe("shield charges", () => {
  const none = step(player(MAX_HP), { shield: 1 });
  test("in royale you start with no charge, and E does nothing then", () => {
    expect(none.shield).toBe(false);
    expect(none.sim.shieldCd).toBe(0);
  });
  const first = step(player(MAX_HP, { shields: 2 }), { shield: 1 });
  test("E uses one charge", () => {
    expect(first.shield).toBe(true);
    expect(first.sim.kit.shields).toBe(1);
    expect(first.sim.shieldCd).toBe(SHIELD_CHARGE_TICKS);
  });
  test("the next can't go up before this bubble ends plus the gap: no chaining", () => {
    expect(SHIELD_CHARGE_TICKS).toBeGreaterThan(SHIELD_TICKS);
    expect(SHIELD_CHARGE_TICKS - SHIELD_TICKS).toBe(ticks(ROYALE.shieldGap));
  });
  let shieldSeen = 1;
  let waited = 0;
  let second = first;
  while (waited < SHIELD_CHARGE_TICKS + 5) {
    second = step(second.sim, { shield: ++shieldSeen });
    waited++;
    if (second.shield) break;
  }
  test(`the second one only after the wait (${waited} steps)`, () => {
    expect(second.shield).toBe(true);
    expect(waited).toBe(SHIELD_CHARGE_TICKS);
    expect(second.sim.kit.shields).toBe(0);
  });
  let sc = step(second.sim, { shield: ++shieldSeen });
  for (let i = 0; i < SHIELD_CHARGE_TICKS + 2; i++) sc = step(sc.sim, { shield: ++shieldSeen });
  const spent = sc;
  test("with none left, E does nothing", () => {
    expect(spent.shield).toBe(false);
    expect(spent.sim.kit.shields).toBe(0);
  });
  const other = stepPlayer(open, player(MAX_HP), { ...idle, seq: ++seq, shield: 1 }, RIFLE, can);
  test("the other modes keep the shield on its cooldown, no charge needed", () => {
    expect(other.shield).toBe(true);
    expect(other.sim.shieldCd).toBe(SHIELD_COOLDOWN_TICKS);
  });
});

describe("the input", () => {
  const base = { seq: 1, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0 };
  test("heal and use read as 0 when missing", () => {
    expect(parseInput(base)?.heal).toBe(0);
    expect(parseInput(base)?.use).toBe(0);
  });
  test("a medkit use is a valid input", () => {
    expect(parseInput({ ...base, heal: HEAL_MEDKIT, use: 3 })?.heal).toBe(HEAL_MEDKIT);
  });
  test("an unknown item or a bad counter is refused", () => {
    expect(parseInput({ ...base, heal: 2 })).toBeNull();
    expect(parseInput({ ...base, use: -1 })).toBeNull();
  });
});
