// Tests of the battle royale's rules (royale.ts, rankRoyale in modes.ts): the
// ranking by order of knock-out, the zone over time, the grenade stacks, the
// gun slots (and the step's switch, which the client predicts), the loot
// table, and the royale maps' crate spots.
// Run with `bun run test` (or `bun test src/royale.test.ts` in packages/shared).
//
// The steps run in order in the describe bodies (the input seq counts up
// across them), and each test only asserts on their results.

import { describe, expect, test } from "bun:test";
import { playerCan, spawnSim, stepPlayer } from "./combat.ts";
import { GRENADES, GRENADE_FRAG, GRENADE_SMOKE, ITEM_GRENADE, ITEM_GUN, LOOT, PISTOL, PLAYER_RADIUS, ROYALE, TICK_RATE, WEAPONS, ZONE, ticks } from "./constants.ts";
import { MAPS, ROYALE_MAPS } from "./maps/index.ts";
import { lotOf, rankRoyale, ROYALE_RULES, type RoyaleStanding } from "./modes.ts";
import { circleOverlapsBox } from "./physics.ts";
import type { FloorItemView, InputMessage, PlayerSim, ZoneView } from "./protocol.ts";
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
  swapTarget,
  takeGrenades,
  takeGun,
  useGrenade,
  zoneAt,
  zoneDamage,
} from "./royale.ts";

describe("ranking: order of knock-out, not kills", () => {
  const st = (id: string, outTick: number, kills = 0, damage = 0): RoyaleStanding => ({ id, outTick, kills, damage });
  const ids = (r: ReturnType<typeof rankRoyale>) => r.order.map((o) => o.entry.id).join(",");

  // The survivor first, then the last one out... the first one out last, whatever the kills.
  const byDeath = rankRoyale([st("early", 100, 5, 900), st("winner", 0, 0, 10), st("late", 400, 1), st("mid", 250, 3)], "m");
  test(`places follow the order of knock-out, not kills (${ids(byDeath)})`, () => {
    expect(ids(byDeath)).toBe("winner,late,mid,early");
    expect(byDeath.reason).toBe("");
  });
  test("every place is its own, 1 to n", () => {
    expect(byDeath.order.map((o) => o.place)).toEqual([1, 2, 3, 4]);
  });

  // Same tick: kills, then damage, then the lot.
  const sameKills = rankRoyale([st("a", 300, 1, 50), st("b", 300, 2, 10), st("c", 100)], "m");
  test(`the last two out on the same tick: more kills wins (${ids(sameKills)}, "${sameKills.reason}")`, () => {
    expect(ids(sameKills)).toBe("b,a,c");
    expect(sameKills.reason).toBe("kills");
  });
  const sameDamage = rankRoyale([st("a", 300, 2, 50), st("b", 300, 2, 80)], "m");
  test(`then more damage (${ids(sameDamage)}, "${sameDamage.reason}")`, () => {
    expect(ids(sameDamage)).toBe("b,a");
    expect(sameDamage.reason).toBe("damage");
  });
  const tied = [st("a", 300), st("b", 300), st("c", 300)];
  const lot = rankRoyale(tied, "room:m1");
  test(`then the lot, reproducible from the match id (${ids(lot)})`, () => {
    const expected = [...tied].sort((x, y) => lotOf("room:m1", x.id) - lotOf("room:m1", y.id)).map((e) => e.id).join(",");
    expect(ids(lot)).toBe(expected);
    expect(lot.reason).toBe("lot");
  });
  test("the lot doesn't depend on the input order", () => {
    expect(ids(rankRoyale([...tied].reverse(), "room:m1"))).toBe(ids(lot));
  });
  // A tie lower down doesn't touch first place or the reason.
  const lowTie = rankRoyale([st("w", 0), st("x", 200, 0), st("y", 200, 3)], "m");
  test(`a same-tick tie further down: split there, first won outright (${ids(lowTie)})`, () => {
    expect(ids(lowTie)).toBe("w,y,x");
    expect(lowTie.reason).toBe("");
  });
  // A leaver is knocked out when they leave: no 1st place for leaving early.
  test("leaving early is a knock-out at that tick, not a win", () => {
    expect(ids(rankRoyale([st("left", 50, 4, 400), st("stayed", 0)], "m"))).toBe("stayed,left");
  });
  test("nobody: an empty order", () => {
    expect(rankRoyale([], "m").order).toHaveLength(0);
  });
});

describe("the zone", () => {
  const zone: ZoneView = { x0: 0, z0: 0, x1: 8, z1: -6, r0: 40, r1: 0, start: 900, end: 8100 };
  const halfway = (zone.start + zone.end) / 2;
  const cMid = zoneAt(zone, halfway)!;
  test("before it shrinks: the start circle", () => {
    const c0 = zoneAt(zone, 0)!;
    expect(c0.r).toBe(40);
    expect(zoneAt(zone, zone.start)!.r).toBe(40);
    expect(c0.x).toBe(0);
  });
  test(`halfway: half the radius, halfway to the end centre (r ${cMid.r})`, () => {
    expect(cMid.r).toBeCloseTo(20, 9);
    expect(cMid.x).toBeCloseTo(4, 9);
    expect(cMid.z).toBeCloseTo(-3, 9);
  });
  test("closed at the end tick, and stays closed", () => {
    const cEnd = zoneAt(zone, zone.end)!;
    expect(cEnd.r).toBe(0);
    expect(cEnd.x).toBe(8);
    expect(cEnd.z).toBe(-6);
    expect(zoneAt(zone, zone.end + 3000)!.r).toBe(0);
  });
  test("it shrinks a little every tick, never grows, no steps", () => {
    const bad: number[] = [];
    for (let t = zone.start; t < zone.end; t += 7) if (zoneAt(zone, t + 1)!.r > zoneAt(zone, t)!.r || zoneAt(zone, t)!.r - zoneAt(zone, t + 1)!.r > 0.01) bad.push(t);
    expect(bad).toEqual([]);
  });
  test("no zone (end 0): nobody is outside", () => {
    expect(zoneAt({ ...zone, end: 0 }, 5000)).toBeNull();
    expect(outsideZone({ ...zone, end: 0 }, 5000, 99, 99)).toBe(false);
  });
  test("inside is safe, outside isn't", () => {
    expect(outsideZone(zone, zone.end - 1, 8, -6)).toBe(false);
    expect(outsideZone(zone, halfway, 30, 0)).toBe(true);
  });
  test(`the real zone closes by 4:30 (${ZONE.close} s)`, () => {
    expect(ROYALE_RULES.royale?.zoneClose).toBe(ZONE.close);
    expect(ZONE.close).toBeLessThanOrEqual(4.5 * 60);
    expect(ZONE.wait).toBeLessThan(ZONE.close);
  });

  // Damage outside: whole HP each tick, growing, summing to the dose.
  const perSecond = (from: number) => {
    let n = 0;
    for (let t = from; t < from + TICK_RATE; t++) n += zoneDamage(zone, t);
    return n;
  };
  test("no damage before it shrinks", () => {
    expect(zoneDamage(zone, zone.start - 5)).toBe(0);
    expect(perSecond(zone.start - TICK_RATE)).toBe(0);
  });
  const early = perSecond(zone.start + 1);
  const mid = perSecond(halfway);
  const late = perSecond(zone.end + 60);
  test(`about ${ZONE.dpsStart} HP a second at first (${early})`, () => {
    expect(early).toBeGreaterThanOrEqual(ZONE.dpsStart - 1);
    expect(early).toBeLessThanOrEqual(ZONE.dpsStart + 1);
  });
  test(`it grows as the zone closes (${early}, ${mid}, ${late} per second)`, () => {
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
  });
  test(`about ${ZONE.dpsEnd} HP a second once closed (${late})`, () => {
    expect(Math.abs(late - ZONE.dpsEnd)).toBeLessThanOrEqual(1);
  });
  test("every tick's damage is a whole, non-negative number", () => {
    const bad: number[] = [];
    for (let t = zone.start; t < zone.end + 300; t += 13) if (!Number.isInteger(zoneDamage(zone, t)) || zoneDamage(zone, t) < 0) bad.push(t);
    expect(bad).toEqual([]);
  });

  // The zone of a real match: covers the map, closes on the drawn centre inside the limits.
  for (const map of ROYALE_MAPS) {
    const z = pickZone(map, "room:abc", 100, 100 + ticks(ZONE.close));
    const lim = map.royale!.zone;
    test(`${map.id}: the zone starts round the whole map (r ${z.r0.toFixed(1)})`, () => {
      expect(z.r0).toBeGreaterThanOrEqual(Math.hypot(map.halfX, map.halfZ));
    });
    test(`${map.id}: it closes on a centre inside its limits (${z.x1.toFixed(1)}, ${z.z1.toFixed(1)})`, () => {
      expect(z.x1).toBeGreaterThanOrEqual(lim.x0);
      expect(z.x1).toBeLessThanOrEqual(lim.x1);
      expect(z.z1).toBeGreaterThanOrEqual(lim.z0);
      expect(z.z1).toBeLessThanOrEqual(lim.z1);
      expect(z.r1).toBe(0);
    });
    test(`${map.id}: the centre comes from the match seed`, () => {
      const again = pickZone(map, "room:abc", 100, 200);
      const other = pickZone(map, "room:xyz", 100, 200);
      expect([again.x1, again.z1]).toEqual([z.x1, z.z1]);
      expect([other.x1, other.z1]).not.toEqual([z.x1, z.z1]);
    });
  }
});

describe("grenade stacks", () => {
  const fragMax = GRENADES[GRENADE_FRAG].stack;
  test("none held: the stack is taken", () => {
    const none = takeGrenades({ type: GRENADE_FRAG, count: 0 }, { type: GRENADE_SMOKE, count: 1 });
    expect(none.held).toEqual({ type: GRENADE_SMOKE, count: 1 });
    expect(none.left).toBe(0);
    expect(none.dropped).toBeNull();
  });
  test("the same type adds to the stack", () => {
    const add = takeGrenades({ type: GRENADE_FRAG, count: 1 }, { type: GRENADE_FRAG, count: 1 });
    expect(add.held.count).toBe(2);
    expect(add.left).toBe(0);
    expect(add.dropped).toBeNull();
  });
  test(`up to the type's maximum (${fragMax}); the rest stays on the floor`, () => {
    const cap = takeGrenades({ type: GRENADE_FRAG, count: fragMax - 1 }, { type: GRENADE_FRAG, count: 2 });
    expect(cap.held.count).toBe(fragMax);
    expect(cap.left).toBe(1);
    expect(cap.taken).toBe(1);
  });
  test("at the maximum: nothing is taken", () => {
    const full = takeGrenades({ type: GRENADE_FRAG, count: fragMax }, { type: GRENADE_FRAG, count: 2 });
    expect(full.taken).toBe(0);
    expect(full.left).toBe(2);
    expect(full.held.count).toBe(fragMax);
  });
  test("another type swaps in, and the old stack drops", () => {
    const swap = takeGrenades({ type: GRENADE_FRAG, count: 2 }, { type: GRENADE_SMOKE, count: 1 });
    expect(swap.held).toEqual({ type: GRENADE_SMOKE, count: 1 });
    expect(swap.dropped).toEqual({ type: GRENADE_FRAG, count: 2 });
    expect(swap.left).toBe(0);
  });
  test("each throw uses one, never below 0", () => {
    expect([useGrenade(2), useGrenade(1), useGrenade(0)]).toEqual([1, 0, 0]);
  });
  test("every grenade type has a stack of at least 1", () => {
    for (const g of GRENADES) expect(g.stack).toBeGreaterThanOrEqual(1);
  });
});

describe("gun slots", () => {
  const RIFLE = 0;
  const SMG = WEAPONS.findIndex((w) => w.key === "smg");
  const SNIPER = WEAPONS.findIndex((w) => w.key === "sniper");
  const DMR = WEAPONS.findIndex((w) => w.key === "dmr");
  const start = spawnSim(0, 0, RIFLE, undefined, startKit());
  test("the start: the Pistol in slot 1, in hand, full; slots 2-3 empty", () => {
    expect(gunInHand(start.kit)).toBe(PISTOL);
    expect(start.ammo).toBe(WEAPONS[PISTOL].magazine);
    expect(gunAt(start.kit, 1)).toBe(NO_GUN);
  });
  test("the Pistol is a starting gun only (pickable: false)", () => {
    expect(WEAPONS[PISTOL].pickable).toBe(false);
  });

  const one = takeGun(start, RIFLE, 7)!;
  test("a gun fills the first free slot, with its magazine; the one in hand stays", () => {
    expect(one).toBeTruthy();
    expect(gunAt(one.kit, 1)).toBe(RIFLE);
    expect(one.kit.mag1).toBe(7);
    expect(gunInHand(one.kit)).toBe(PISTOL);
  });
  test("a gun already carried stays on the floor", () => {
    expect(takeGun(one, RIFLE, 12)).toBeNull();
  });
  const two = takeGun(one, SMG, 30)!;
  test("with 3 guns, walking over another does nothing", () => {
    expect(freeGunSlot(two.kit)).toBe(-1);
    expect(takeGun(two, SNIPER, 4)).toBeNull();
  });

  // Switching through the step: each gun keeps its magazine, the switch cancels a reload.
  const idle: InputMessage = { seq: 0, mx: 0, mz: 0, aim: 0, fire: false, gx: 0, gz: 0, dash: 0, grenade: 0, shield: 0, reload: 0, slot: 0, switch: 0, swap: 0 };
  const can = playerCan(true, "playing");
  const open = { halfX: 20, halfZ: 20, obstacles: [] };
  let seq = 0;
  const step = (s: PlayerSim, extra: Partial<InputMessage>) => stepPlayer(open, s, { ...idle, seq: ++seq, ...extra }, RIFLE, can, GRENADE_FRAG, "slots");
  let s = { ...two, ammo: 4 }; // 4 left in the Pistol
  let r = step(s, { slot: 1, switch: 1 });
  s = r.sim;
  const toRifle = s;
  test(`switch to slot 2: the rifle's 7 in hand, the Pistol keeps its 4 (${toRifle.ammo}, ${magAt(toRifle, 0)})`, () => {
    expect(gunInHand(toRifle.kit)).toBe(RIFLE);
    expect(toRifle.ammo).toBe(7);
    expect(magAt(toRifle, 0)).toBe(4);
  });
  const delay = ticks(ROYALE.switchTime);
  let fired = -1;
  for (let i = 0; i < delay + 3 && fired < 0; i++) {
    r = step(s, { fire: true, switch: 1, slot: 1 });
    s = r.sim;
    if (r.fired) fired = i + 1;
  }
  const afterShot = s;
  test(`a switch waits ${ROYALE.switchTime} s (${delay} steps) before it can fire (fired on step ${fired})`, () => {
    expect(fired).toBe(delay);
  });
  test("the shot came out of the rifle's magazine", () => {
    expect(afterShot.ammo).toBe(6);
  });
  r = step(s, { reload: 1, switch: 1, slot: 1 });
  s = r.sim;
  const reloading = s;
  test("a reload starts", () => {
    expect(reloading.reloadTicks).toBeGreaterThan(0);
  });
  r = step(s, { reload: 1, switch: 2, slot: 2 });
  s = r.sim;
  const toSmg = s;
  test("switching away mid-reload cancels it: the rifle keeps 6, the SMG's 30 in hand", () => {
    expect(gunInHand(toSmg.kit)).toBe(SMG);
    expect(toSmg.reloadTicks).toBe(0);
    expect(toSmg.ammo).toBe(30);
    expect(magAt(toSmg, 1)).toBe(6);
  });
  r = step(s, { reload: 1, switch: 3, slot: 1 });
  s = r.sim;
  const back = s;
  test("and back: the rifle's magazine as it was (not refilled)", () => {
    expect(gunInHand(back.kit)).toBe(RIFLE);
    expect(back.ammo).toBe(6);
  });
  const same = step(s, { reload: 1, switch: 4, slot: 1 }).sim;
  test("asking for the slot in hand does nothing", () => {
    expect(same.fireCd).toBeLessThanOrEqual(back.fireCd);
  });
  test("an empty slot can't be switched to", () => {
    const toEmpty = stepPlayer(open, { ...one, kit: { ...one.kit } }, { ...idle, seq: 999, switch: 1, slot: 2 }, RIFLE, can, GRENADE_FRAG, "slots").sim;
    expect(gunInHand(toEmpty.kit)).toBe(PISTOL);
  });
  test("dead: the press is used up and nothing switches", () => {
    const dead = stepPlayer(open, two, { ...idle, seq: 1000, switch: 1, slot: 1 }, RIFLE, playerCan(false, "playing"), GRENADE_FRAG, "slots").sim;
    expect(gunInHand(dead.kit)).toBe(PISTOL);
    expect(dead.kit.switchSeen).toBe(1);
  });
  test("the other modes (loadout): the switch press does nothing", () => {
    const loadout = stepPlayer(open, two, { ...idle, seq: 1001, switch: 1, slot: 1 }, RIFLE, can).sim;
    expect(gunInHand(loadout.kit)).toBe(PISTOL);
  });

  // The wheel: carried slots only.
  test("the wheel cycles through carried guns", () => {
    expect(cycleSlot(two.kit, 1)).toBe(1);
    expect(cycleSlot({ ...two.kit, hand: 2 }, 1)).toBe(0);
    expect(cycleSlot(two.kit, -1)).toBe(2);
  });
  test("skipping empty slots (alone: stays)", () => {
    expect(cycleSlot({ ...one.kit, hand: 1 }, 1)).toBe(0);
    expect(cycleSlot(start.kit, 1)).toBe(0);
  });

  // F swap: the floor gun takes the hand's place, the old one drops with its magazine.
  const held = { ...s }; // rifle in hand with 6
  const sw = swapGun(held, SNIPER, 3)!;
  test("F swaps the floor gun into the hand; the old one drops, magazine as it was", () => {
    expect(sw).toBeTruthy();
    expect(gunInHand(sw.sim.kit)).toBe(SNIPER);
    expect(sw.sim.ammo).toBe(3);
    expect(sw.dropped.weapon).toBe(RIFLE);
    expect(sw.dropped.mag).toBe(6);
  });
  test("the swapped-in gun waits the switch delay too; still 3 guns", () => {
    expect(sw.sim.fireCd).toBeGreaterThanOrEqual(delay);
    expect(carriedGuns(sw.sim)).toHaveLength(3);
  });
  test("F on a gun already carried does nothing", () => {
    expect(swapGun(held, SMG, 30)).toBeNull();
  });
  test("still full after a swap", () => {
    expect(takeGun(sw.sim, DMR, 8)).toBeNull();
  });

  // Which floor gun F takes (swapTarget): the server's F and the HUD's prompt both ask it.
  const gunItem = (item: number, x: number, blockedFor = ""): FloorItemView => ({ x, z: 0, kind: ITEM_GUN, item, amount: WEAPONS[item].magazine, blockedFor });
  const floor = (...its: [string, FloorItemView][]) => new Map(its);
  const reach = ROYALE.pickupRadius;
  const tgt = (items: Map<string, FloorItemView>, kit = held.kit, pid = "me") => swapTarget(kit, 0, 0, items, pid)?.id ?? null;
  test("swapTarget: a gun in reach, not carried", () => {
    expect(tgt(floor(["a", gunItem(SNIPER, 0.5)]))).toBe("a");
  });
  test("swapTarget: the pickup radius is the reach, edge included", () => {
    expect(tgt(floor(["a", gunItem(SNIPER, reach)]))).toBe("a");
    expect(tgt(floor(["a", gunItem(SNIPER, reach + 0.01)]))).toBeNull();
  });
  test("swapTarget: the nearest gun wins, whatever the order", () => {
    expect(tgt(floor(["far", gunItem(SNIPER, 0.8)], ["near", gunItem(DMR, 0.3)]))).toBe("near");
  });
  test("swapTarget: a tie goes to the first one met", () => {
    expect(tgt(floor(["a", gunItem(SNIPER, 0.5)], ["b", gunItem(DMR, -0.5)]))).toBe("a");
  });
  test("swapTarget: only guns count", () => {
    const frag: FloorItemView = { x: 0.1, z: 0, kind: ITEM_GRENADE, item: GRENADE_FRAG, amount: 2, blockedFor: "" };
    expect(tgt(floor(["g", frag], ["a", gunItem(SNIPER, 0.6)]))).toBe("a");
  });
  test("swapTarget: a gun blocked for us (dropped under our feet) is skipped", () => {
    expect(tgt(floor(["mine", gunItem(SNIPER, 0.1, "me")], ["a", gunItem(DMR, 0.6)]))).toBe("a");
  });
  test("swapTarget: blocked for someone else doesn't matter", () => {
    expect(tgt(floor(["theirs", gunItem(SNIPER, 0.1, "other")]))).toBe("theirs");
  });
  test("swapTarget: right after a swap, the gun we dropped isn't offered back", () => {
    expect(tgt(floor(["mine", gunItem(SNIPER, 0.1, "me")]))).toBeNull();
  });
  test("swapTarget: the nearest gun already carried: F does nothing (the server never looked further)", () => {
    expect(tgt(floor(["carried", gunItem(SMG, 0.2)], ["a", gunItem(SNIPER, 0.6)]))).toBeNull();
  });
  test("swapTarget: nothing when the hand isn't a gun slot", () => {
    expect(tgt(floor(["a", gunItem(SNIPER, 0.5)]), { ...held.kit, hand: 5 })).toBeNull();
  });
  test("swapTarget: nothing on the floor", () => {
    expect(tgt(floor())).toBeNull();
  });
  test("swapTarget's pick is one swapGun accepts", () => {
    const t0 = swapTarget(held.kit, 0, 0, floor(["a", gunItem(SNIPER, 0.5)]), "me");
    expect(t0).not.toBeNull();
    expect(swapGun(held, t0!.item.item, t0!.item.amount)).not.toBeNull();
  });

  // Counted grenades in the step (royale) against the cooldown (the other modes).
  const withTwo = { ...start, kit: { ...start.kit, grenades: 2 } };
  const g1 = stepPlayer(open, withTwo, { ...idle, seq: 1, grenade: 1, gx: 3 }, RIFLE, can, GRENADE_FRAG, "slots");
  test("a throw uses one grenade, and a short gap follows", () => {
    expect(g1.grenade).toBeTruthy();
    expect(g1.sim.kit.grenades).toBe(1);
    expect(g1.sim.grenadeCd).toBe(ticks(ROYALE.throwGap));
  });
  const g2 = stepPlayer(open, g1.sim, { ...idle, seq: 2, grenade: 2, gx: 3 }, RIFLE, can, GRENADE_FRAG, "slots");
  test("no second throw inside the gap", () => {
    expect(g2.grenade).toBeFalsy();
    expect(g2.sim.kit.grenades).toBe(1);
  });
  test("with 0 grenades, nothing to throw", () => {
    const empty = { ...start, kit: { ...start.kit, grenades: 0 } };
    const none0 = stepPlayer(open, empty, { ...idle, seq: 3, grenade: 1, gx: 3 }, RIFLE, can, GRENADE_FRAG, "slots");
    expect(none0.grenade).toBeFalsy();
  });
  test("the other modes keep the grenade on its cooldown, uncounted", () => {
    const cooled = stepPlayer(open, spawnSim(0, 0, RIFLE), { ...idle, seq: 1, grenade: 1, gx: 3 }, RIFLE, can, GRENADE_FRAG);
    expect(cooled.grenade).toBeTruthy();
    expect(cooled.sim.kit.grenades).toBe(0);
    expect(cooled.sim.grenadeCd).toBe(ticks(GRENADES[GRENADE_FRAG].cooldown));
  });
});

describe("loot", () => {
  const draws = new Map<string, number>();
  const invalid: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const d = rollLoot((i + 0.5) / 1000);
    const key = `${d.kind}:${d.item}`;
    draws.set(key, (draws.get(key) ?? 0) + 1);
    if (d.item < 0 || d.amount < 1) invalid.push(`loot ${key} is valid`);
  }
  test("every loot draw is a real item, at least 1 of it", () => {
    expect(invalid).toEqual([]);
  });
  test(`every loot line can drop (${draws.size} of ${LOOT.length})`, () => {
    expect(draws.size).toBe(LOOT.length);
  });
  test("the loot names real guns, never the Pistol", () => {
    for (const e of LOOT) if (e.kind === "gun") expect(WEAPONS.some((w) => w.key === e.key && w.key !== "pistol")).toBe(true);
  });
  test("no loot stack is over its type's maximum", () => {
    for (const e of LOOT) if (e.kind === "grenade") expect(e.amount).toBeLessThanOrEqual(GRENADES.find((x) => x.key === e.key)!.stack);
  });
});

describe("maps: crate spots", () => {
  test(`royale maps: ${ROYALE_MAPS.map((m) => m.id).join(", ")} (never a duel map)`, () => {
    expect(ROYALE_MAPS.length).toBeGreaterThanOrEqual(1);
    for (const m of ROYALE_MAPS) expect(MAPS).not.toContain(m);
  });
  for (const map of ROYALE_MAPS) {
    const crates = map.royale!.crates;
    const far = Math.min(...crates.flatMap((c) => map.spawns.map((sp) => Math.hypot(sp.x - c.x, sp.z - c.z))));
    test(`${map.id}: ${crates.length} crates on open floor, inside the walls`, () => {
      expect(crates.length).toBeGreaterThanOrEqual(10);
      expect(crates.filter((c) => Math.abs(c.x) > map.halfX - 1 || Math.abs(c.z) > map.halfZ - 1)).toEqual([]);
      expect(crates.filter((c) => map.obstacles.some((b) => circleOverlapsBox(c.x, c.z, ROYALE.crateRadius + PLAYER_RADIUS, b)))).toEqual([]);
    });
    test(`${map.id}: no crate within 3 m of a spawn (closest ${far.toFixed(1)} m)`, () => {
      expect(far).toBeGreaterThanOrEqual(3);
    });
  }
});
