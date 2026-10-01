// Tests of the battle royale's chests and F (royale.ts "Chests and F"): which
// chest F opens (`chestTarget`), what F does when a chest and floor items are
// both in reach (`fTarget`, the nearest wins), loot that can't be taken
// until it has landed (`itemReady`), grenade stacks taken by walking over
// them only when that swaps nothing (`walkTakesGrenades`, `grenadeSwapTarget`),
// perks the same way (`walkTakesPerk`, `perkSwapTarget`: one slot, F swaps),
// chests dropping perks (`rollLoot`), and where a chest's loot lands (`lootSpot`).
// Run with `bun run test` (or `bun test src/chests.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import { GRENADE_FRAG, GRENADE_SMOKE, ITEM_GRENADE, ITEM_GUN, ITEM_HEAL, ITEM_PERK, LOOT, NO_PERK, PERKS, PISTOL, ROYALE, WEAPONS, ticks } from "./constants.ts";
import { MAPS, ROYALE_MAPS } from "./maps/index.ts";
import type { MapDef } from "./maps/types.ts";
import { circleOverlapsBox } from "./physics.ts";
import type { CrateView, FloorItemView, KitSim } from "./protocol.ts";
import {
  ITEM_CLEARANCE,
  chestTarget,
  fTarget,
  grenadeSwapTarget,
  itemReady,
  lootSpot,
  perkSwapTarget,
  rollLoot,
  startKit,
  swapTarget,
  walkTakesGrenades,
  walkTakesPerk,
  type GrenadeStack,
} from "./royale.ts";

const RIFLE = WEAPONS.findIndex((w) => w.key === "rifle");
const SMG = WEAPONS.findIndex((w) => w.key === "smg");
const SNIPER = WEAPONS.findIndex((w) => w.key === "sniper");
const DMR = WEAPONS.findIndex((w) => w.key === "dmr");

const item = (kind: number, it: number, x: number, z = 0, extra: Partial<FloorItemView> = {}): FloorItemView => ({
  x,
  z,
  kind,
  item: it,
  amount: kind === ITEM_GUN ? WEAPONS[it].magazine : 1,
  blockedFor: "",
  fromX: 0,
  fromZ: 0,
  dropTick: 0,
  readyTick: 0,
  ...extra,
});
const chest = (x: number, z = 0, open = false): CrateView => ({ x, z, open });
const items = (...its: [string, FloorItemView][]) => new Map(its);
const chests = (...cs: [string, CrateView][]) => new Map(cs);

/** All three slots full (Pistol, rifle, SMG), the Pistol in hand. */
const full: KitSim = { ...startKit(), gun1: RIFLE, mag1: 30, gun2: SMG, mag2: 30 };
/** The Pistol only: two free slots. */
const roomy: KitSim = startKit();
const noNades: GrenadeStack = { type: GRENADE_FRAG, count: 0 };
const frags: GrenadeStack = { type: GRENADE_FRAG, count: 2 };

describe("chestTarget: which chest F opens", () => {
  test("a closed chest within ROYALE.openRadius, edge included", () => {
    expect(chestTarget(0, 0, chests(["c", chest(ROYALE.openRadius)]))?.id).toBe("c");
    expect(chestTarget(0, 0, chests(["c", chest(ROYALE.openRadius + 0.01)]))).toBeNull();
  });
  test("an open chest is never offered", () => {
    expect(chestTarget(0, 0, chests(["c", chest(0.5, 0, true)]))).toBeNull();
  });
  test("the nearest closed one wins, an open one nearer doesn't hide it", () => {
    expect(chestTarget(0, 0, chests(["far", chest(1.2)], ["near", chest(-0.8)], ["open", chest(0.2, 0, true)]))?.id).toBe("near");
  });
  test("you can open it from further than you pick items up (it is bigger than an item)", () => {
    expect(ROYALE.openRadius).toBeGreaterThan(ROYALE.pickupRadius);
  });
});

describe("itemReady: loot can't be taken while it falls", () => {
  const falling = item(ITEM_GUN, SNIPER, 0.3, 0, { dropTick: 100, readyTick: 100 + ticks(ROYALE.lootDrop) });
  test("not before its readyTick, from it on", () => {
    expect(itemReady(falling, 100)).toBe(false);
    expect(itemReady(falling, falling.readyTick - 1)).toBe(false);
    expect(itemReady(falling, falling.readyTick)).toBe(true);
  });
  test("the drop is short, between half a second and a second", () => {
    expect(ROYALE.lootDrop).toBeGreaterThanOrEqual(0.5);
    expect(ROYALE.lootDrop).toBeLessThanOrEqual(0.8);
  });
  test("everything else (readyTick 0) is ready at once", () => {
    expect(itemReady(item(ITEM_GUN, SNIPER, 0), 0)).toBe(true);
  });
  test("F doesn't swap for a falling gun, and offers it once landed", () => {
    expect(swapTarget(full, 0, 0, items(["s", falling]), "me", 101)).toBeNull();
    expect(swapTarget(full, 0, 0, items(["s", falling]), "me", falling.readyTick)?.id).toBe("s");
  });
  test("nor for a falling grenade stack", () => {
    const smoke = item(ITEM_GRENADE, GRENADE_SMOKE, 0.3, 0, { dropTick: 100, readyTick: 112 });
    expect(grenadeSwapTarget(frags, 0, 0, items(["g", smoke]), "me", 105)).toBeNull();
    expect(grenadeSwapTarget(frags, 0, 0, items(["g", smoke]), "me", 112)?.id).toBe("g");
  });
});

describe("grenade stacks: walking over takes them only when that swaps nothing", () => {
  test("none held: taken (like a gun into a free slot)", () => {
    expect(walkTakesGrenades(noNades, GRENADE_SMOKE)).toBe(true);
  });
  test("the same type: taken (topped up)", () => {
    expect(walkTakesGrenades(frags, GRENADE_FRAG)).toBe(true);
  });
  test("another type: left on the floor, for F", () => {
    expect(walkTakesGrenades(frags, GRENADE_SMOKE)).toBe(false);
  });
  const smoke = item(ITEM_GRENADE, GRENADE_SMOKE, 0.4);
  test("grenadeSwapTarget: another type in reach", () => {
    expect(grenadeSwapTarget(frags, 0, 0, items(["g", smoke]), "me", 0)?.id).toBe("g");
  });
  test("grenadeSwapTarget: nothing to swap with none held, or the same type", () => {
    expect(grenadeSwapTarget(noNades, 0, 0, items(["g", smoke]), "me", 0)).toBeNull();
    expect(grenadeSwapTarget(frags, 0, 0, items(["g", item(ITEM_GRENADE, GRENADE_FRAG, 0.4)]), "me", 0)).toBeNull();
  });
  test("grenadeSwapTarget: out of reach, or blocked for us (we just dropped it)", () => {
    expect(grenadeSwapTarget(frags, 0, 0, items(["g", item(ITEM_GRENADE, GRENADE_SMOKE, ROYALE.pickupRadius + 0.01)]), "me", 0)).toBeNull();
    expect(grenadeSwapTarget(frags, 0, 0, items(["g", item(ITEM_GRENADE, GRENADE_SMOKE, 0.2, 0, { blockedFor: "me" })]), "me", 0)).toBeNull();
  });
  test("grenadeSwapTarget: only grenades count", () => {
    expect(grenadeSwapTarget(frags, 0, 0, items(["gun", item(ITEM_GUN, SNIPER, 0.1)], ["g", smoke]), "me", 0)?.id).toBe("g");
  });
});

const DOUBLE = PERKS.findIndex((p) => p.key === "double-dash");
const BIG_MAG = PERKS.findIndex((p) => p.key === "big-mag");

describe("perks: one slot, walked over with none held, F swaps", () => {
  test("none held: walking over one takes it", () => {
    expect(walkTakesPerk(NO_PERK)).toBe(true);
  });
  test("one held: walking over another (or the same) leaves it on the floor", () => {
    expect(walkTakesPerk(DOUBLE)).toBe(false);
  });
  test("perkSwapTarget: another perk in reach, holding one", () => {
    expect(perkSwapTarget(DOUBLE, 0, 0, items(["p", item(ITEM_PERK, BIG_MAG, 0.5)]), "me", 0)?.id).toBe("p");
  });
  test("perkSwapTarget: nothing to swap with none held, or the same perk", () => {
    expect(perkSwapTarget(NO_PERK, 0, 0, items(["p", item(ITEM_PERK, BIG_MAG, 0.5)]), "me", 0)).toBeNull();
    expect(perkSwapTarget(BIG_MAG, 0, 0, items(["p", item(ITEM_PERK, BIG_MAG, 0.5)]), "me", 0)).toBeNull();
  });
  test("perkSwapTarget: out of reach, blocked for us (we just dropped it), or still falling", () => {
    expect(perkSwapTarget(DOUBLE, 0, 0, items(["p", item(ITEM_PERK, BIG_MAG, ROYALE.pickupRadius + 0.1)]), "me", 0)).toBeNull();
    expect(perkSwapTarget(DOUBLE, 0, 0, items(["p", item(ITEM_PERK, BIG_MAG, 0.5, 0, { blockedFor: "me" })]), "me", 0)).toBeNull();
    expect(perkSwapTarget(DOUBLE, 0, 0, items(["p", item(ITEM_PERK, BIG_MAG, 0.5, 0, { readyTick: 10 })]), "me", 5)).toBeNull();
  });
  test("perkSwapTarget: only perks count", () => {
    expect(perkSwapTarget(DOUBLE, 0, 0, items(["g", item(ITEM_GUN, SNIPER, 0.3)], ["h", item(ITEM_HEAL, 0, 0.2)]), "me", 0)).toBeNull();
  });
  test("every perk drops from chests, one at a time", () => {
    const drops = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const d = rollLoot((i + 0.5) / 2000);
      if (d.kind !== ITEM_PERK) continue;
      expect(d.amount).toBe(1);
      drops.add(d.item);
    }
    expect([...drops].sort()).toEqual(PERKS.map((_, i) => i));
    expect(LOOT.filter((e) => e.kind === "perk").length).toBe(PERKS.length);
  });
});

describe("fTarget: what F does", () => {
  const f = (kit: KitSim, held: GrenadeStack, its: Map<string, FloorItemView>, cs: Map<string, CrateView>, tick = 0) => {
    const t = fTarget(kit, held, 0, 0, its, cs, "me", tick);
    return t ? `${t.kind}:${t.id}` : null;
  };
  test("nothing in reach: nothing", () => {
    expect(f(full, frags, items(), chests())).toBeNull();
  });
  test("a closed chest: open it, whatever the kit", () => {
    expect(f(roomy, noNades, items(), chests(["c", chest(1)]))).toBe("chest:c");
    expect(f(full, frags, items(), chests(["c", chest(1)]))).toBe("chest:c");
  });
  test("an open chest: nothing", () => {
    expect(f(full, frags, items(), chests(["c", chest(1, 0, true)]))).toBeNull();
  });
  test("slots full, a gun in reach: swap it", () => {
    expect(f(full, frags, items(["s", item(ITEM_GUN, SNIPER, 0.5)]), chests())).toBe("gun:s");
  });
  test("a free slot: no gun swap (walking over it picks it up)", () => {
    expect(f(roomy, frags, items(["s", item(ITEM_GUN, SNIPER, 0.5)]), chests())).toBeNull();
  });
  test("another grenade type in reach: swap it", () => {
    expect(f(roomy, frags, items(["g", item(ITEM_GRENADE, GRENADE_SMOKE, 0.5)]), chests())).toBe("grenade:g");
  });
  test("healing items and shields are never F's (always walked over)", () => {
    expect(f(full, frags, items(["h", item(ITEM_HEAL, 0, 0.1)]), chests())).toBeNull();
  });
  test("a chest and a gun both in reach: the nearest wins", () => {
    const its = items(["s", item(ITEM_GUN, SNIPER, 0.6)]);
    expect(f(full, frags, its, chests(["c", chest(-1.2)]))).toBe("gun:s");
    expect(f(full, frags, its, chests(["c", chest(-0.4)]))).toBe("chest:c");
  });
  test("a chest and a grenade stack: the nearest wins", () => {
    const its = items(["g", item(ITEM_GRENADE, GRENADE_SMOKE, 0.3)]);
    expect(f(full, frags, its, chests(["c", chest(1)]))).toBe("grenade:g");
    expect(f(full, frags, its, chests(["c", chest(0.2)]))).toBe("chest:c");
  });
  test("a gun and a grenade stack: the nearest wins", () => {
    const its = items(["s", item(ITEM_GUN, DMR, 0.3)], ["g", item(ITEM_GRENADE, GRENADE_SMOKE, -0.6)]);
    expect(f(full, frags, its, chests())).toBe("gun:s");
    const its2 = items(["s", item(ITEM_GUN, DMR, 0.7)], ["g", item(ITEM_GRENADE, GRENADE_SMOKE, -0.2)]);
    expect(f(full, frags, its2, chests())).toBe("grenade:g");
  });
  test("a tie: the chest first, then the gun", () => {
    const its = items(["s", item(ITEM_GUN, DMR, 0.5)], ["g", item(ITEM_GRENADE, GRENADE_SMOKE, -0.5)]);
    expect(f(full, frags, its, chests(["c", chest(0, 0.5)]))).toBe("chest:c");
    expect(f(full, frags, its, chests())).toBe("gun:s");
  });
  test("a gun F can't take (carried already) doesn't hide the chest behind it", () => {
    expect(f(full, frags, items(["r", item(ITEM_GUN, RIFLE, 0.1)]), chests(["c", chest(1)]))).toBe("chest:c");
  });
  test("loot still falling out of the chest is not offered, the chest (open) neither", () => {
    const falling = item(ITEM_GUN, SNIPER, 0.4, 0, { dropTick: 50, readyTick: 62 });
    expect(f(full, frags, items(["s", falling]), chests(["c", chest(1, 0, true)]), 55)).toBeNull();
    expect(f(full, frags, items(["s", falling]), chests(["c", chest(1, 0, true)]), 62)).toBe("gun:s");
  });
  test("holding a perk, another one in reach: swap it; with none held, nothing (walking takes it)", () => {
    const its = items(["p", item(ITEM_PERK, BIG_MAG, 0.5)]);
    expect(fTarget(roomy, noNades, 0, 0, its, chests(), "me", 0, DOUBLE)).toMatchObject({ kind: "perk", id: "p" });
    expect(fTarget(roomy, noNades, 0, 0, its, chests(), "me", 0, NO_PERK)).toBeNull();
    expect(fTarget(roomy, noNades, 0, 0, its, chests(), "me", 0)).toBeNull();
  });
  test("a perk and a chest, or a perk and a gun: the nearest wins, a tie goes to the other", () => {
    const at = (perkX: number, other: [string, FloorItemView][], cs = chests()) =>
      fTarget(full, frags, 0, 0, items(["p", item(ITEM_PERK, BIG_MAG, perkX)], ...other), cs, "me", 0, DOUBLE)?.kind;
    expect(at(0.3, [], chests(["c", chest(1)]))).toBe("perk");
    expect(at(1.2, [], chests(["c", chest(0.5)]))).toBe("chest");
    expect(at(0.5, [], chests(["c", chest(-0.5)]))).toBe("chest");
    expect(at(0.3, [["g", item(ITEM_GUN, SNIPER, 0.6)]])).toBe("perk");
    expect(at(0.6, [["g", item(ITEM_GUN, SNIPER, -0.6)]])).toBe("gun");
  });
  test("its gun pick is swapTarget's", () => {
    const its = items(["a", item(ITEM_GUN, SNIPER, 0.5)], ["b", item(ITEM_GUN, DMR, 0.7)]);
    const t = fTarget(full, frags, 0, 0, its, chests(), "me", 0);
    expect(t?.kind === "gun" ? t.id : null).toBe(swapTarget(full, 0, 0, its, "me", 0)!.id);
    expect(full.gun0).toBe(PISTOL);
  });
});

describe("lootSpot: where a chest's loot lands", () => {
  // A plain 20 x 20 room, with one box east of the chest at (0, 0).
  const base = MAPS[0];
  const room: MapDef = { ...base, halfX: 10, halfZ: 10, obstacles: [{ kind: "crate", x: 1.6, z: 0, w: 1, d: 1, h: 1 }] as MapDef["obstacles"] };
  const empty: MapDef = { ...room, obstacles: [] };
  const okSpot = (map: MapDef, p: { x: number; z: number }) => !map.obstacles.some((b) => circleOverlapsBox(p.x, p.z, ITEM_CLEARANCE, b));
  test("toward the player, ROYALE.lootSpread out", () => {
    const p = lootSpot(empty, 0, 0, 0, []);
    expect(p.x).toBeCloseTo(ROYALE.lootSpread);
    expect(p.z).toBeCloseTo(0);
  });
  test("outside the chest it came from", () => {
    const p = lootSpot(empty, 0, 0, 1, [{ x: 0, z: 0, r: ROYALE.crateRadius + ITEM_CLEARANCE }]);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(ROYALE.crateRadius + ITEM_CLEARANCE);
  });
  test("never inside cover: a box that way sends it round", () => {
    const p = lootSpot(room, 0, 0, 0, []);
    expect(okSpot(room, p)).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(ROYALE.lootSpread);
  });
  test("never on top of an item already there", () => {
    const first = lootSpot(empty, 0, 0, 0, []);
    const second = lootSpot(empty, 0, 0, 0, [{ ...first, r: ROYALE.lootGap }]);
    expect(Math.hypot(second.x - first.x, second.z - first.z)).toBeGreaterThanOrEqual(ROYALE.lootGap);
  });
  test("inside the walls, even from a chest in a corner", () => {
    const p = lootSpot(empty, 9.3, 9.3, Math.PI / 4, []);
    expect(Math.abs(p.x)).toBeLessThan(empty.halfX - 0.5);
    expect(Math.abs(p.z)).toBeLessThan(empty.halfZ - 0.5);
  });
  test("every chest spot of every royale map has a clear spot all round", () => {
    expect(ROYALE_MAPS.length).toBeGreaterThan(0);
    for (const map of ROYALE_MAPS) {
      for (const c of map.royale!.crates) {
        for (let k = 0; k < 8; k++) {
          const p = lootSpot(map, c.x, c.z, (k * Math.PI) / 4, [{ x: c.x, z: c.z, r: ROYALE.crateRadius + ITEM_CLEARANCE }]);
          expect(okSpot(map, p) && Math.hypot(p.x - c.x, p.z - c.z) >= ROYALE.crateRadius + ITEM_CLEARANCE).toBe(true);
        }
      }
    }
  });
});
