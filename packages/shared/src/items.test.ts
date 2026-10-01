// Tests of the item tables (WEAPONS, GRENADES and PERKS in constants.ts): the ids
// that go over the wire never change, keys are unique, and the tables fit
// what carries them. A gun or grenade missing from the client's view tables
// (GUN_VIEW / GRENADE_VIEW / PERK_VIEW, apps/client/src/items.ts) doesn't compile, and
// neither does an effect without a handler (GameRoom's blastEffects).
// Run with `bun run test` (or `bun test src/items.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_GRENADE,
  DEFAULT_WEAPON,
  GRENADES,
  GRENADE_FLASH,
  GRENADE_FRAG,
  GRENADE_SMOKE,
  GRENADE_STUN,
  ITEM_KINDS,
  ITEM_PERK,
  NO_PERK,
  PERKS,
  WEAPONS,
} from "./constants.ts";
import { KILL_GRENADE, KILL_MELEE, KILL_ZONE } from "./protocol.ts";

/**
 * Every weapon and grenade key, at its id (its index). Append-only: a new
 * item is added at the end of its table AND here. Never reorder, rename or
 * remove a line: these numbers are MSG_PICK, `Player.weapon`,
 * `Player.grenade`, `Grenade.kind`, `Player.perk`, a floor perk's `item`
 * and the kill feed.
 */
const WEAPON_IDS = ["rifle", "shotgun", "sniper", "smg", "revolver", "burst-pistol", "dmr", "pistol"];
const GRENADE_IDS = ["frag", "smoke", "stun", "flash", "heal"];
const PERK_IDS = ["double-dash", "long-dash", "quick-dash", "big-mag", "quick-hands"];

const weaponKeys: string[] = WEAPONS.map((w) => w.key);
const grenadeKeys: string[] = GRENADES.map((g) => g.key);
const perkKeys: string[] = PERKS.map((p) => p.key);

describe("item ids", () => {
  test(`weapon ids are frozen, new guns appended (${weaponKeys.join(", ")})`, () => {
    expect(weaponKeys).toEqual(WEAPON_IDS);
  });
  test(`grenade ids are frozen, new types appended (${grenadeKeys.join(", ")})`, () => {
    expect(grenadeKeys).toEqual(GRENADE_IDS);
  });
  test(`perk ids are frozen, new perks appended (${perkKeys.join(", ")})`, () => {
    expect(perkKeys).toEqual(PERK_IDS);
  });
  test("no perk is 255, never a perk id; a floor perk is item kind 4", () => {
    expect(NO_PERK).toBe(255);
    expect(PERKS.length).toBeLessThan(NO_PERK);
    expect(ITEM_PERK).toBe(4);
    expect(ITEM_KINDS[ITEM_PERK]).toBe("perk");
  });
  test("GRENADE_FRAG..GRENADE_FLASH are 0-3 and name their own rows", () => {
    const named = [GRENADE_FRAG, GRENADE_SMOKE, GRENADE_STUN, GRENADE_FLASH];
    expect(named).toEqual([0, 1, 2, 3]);
    expect(named.map((i) => GRENADES[i].key)).toEqual(["frag", "smoke", "stun", "flash"]);
  });
  test("the kill feed's own ids are frozen (grenade 255, zone 254, melee 253), apart, and never a weapon id", () => {
    expect([KILL_GRENADE, KILL_ZONE, KILL_MELEE]).toEqual([255, 254, 253]);
    // Weapon ids grow up from 0: they must never reach the lowest of them.
    expect(WEAPONS.length).toBeLessThan(KILL_MELEE);
  });
  test("the defaults are the rifle and the frag", () => {
    expect(DEFAULT_WEAPON).toBe(0);
    expect(DEFAULT_GRENADE).toBe(GRENADE_FRAG);
  });
});

describe.each([
  ["weapon", weaponKeys],
  ["grenade", grenadeKeys],
  ["perk", perkKeys],
] as const)("%s keys", (what, keys) => {
  test(`every ${what} key is unique`, () => {
    expect(new Set(keys).size).toBe(keys.length);
  });
  test(`${what} keys are lowercase slugs`, () => {
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
  });
});

const EFFECTS: readonly string[] = ["damage", "cloud", "stun", "flash", "heal"];
const AFFECTS: readonly string[] = ["enemies", "allies"];

describe("grenade effects", () => {
  for (const g of GRENADES)
    test(`${g.name}: a known effect (${g.effect}) on a known target (${g.affects})`, () => {
      expect(EFFECTS).toContain(g.effect);
      expect(AFFECTS).toContain(g.affects);
    });
});

// The carriers: uint8 schema fields, the kill feed's weapon id, the number keys.
describe("item carriers", () => {
  test("grenade ids fit a uint8", () => {
    expect(GRENADES.length).toBeLessThanOrEqual(256);
  });
  test(`every weapon has a number key, 1-9 (${WEAPONS.length} weapons)`, () => {
    expect(WEAPONS.length).toBeLessThanOrEqual(9);
  });
});
