// Run with `bun run test` (or `bun test src/loot.test.ts` in apps/client).

import { describe, expect, test } from "bun:test";
import { GRENADE_FRAG, GRENADE_SMOKE, PISTOL, WEAPONS, startKit, type KitSim, type PlayerView } from "@bagarre/shared";
import { lootGained } from "./loot.ts";

const RIFLE = WEAPONS.findIndex((w) => w.key === "rifle");
const SMG = WEAPONS.findIndex((w) => w.key === "smg");

/** Just what lootGained reads: the kit and the grenade type held. */
function view(kit: Partial<KitSim>, grenade = GRENADE_FRAG): PlayerView {
  return { kit: { ...startKit(), ...kit }, grenade } as PlayerView;
}

describe("lootGained", () => {
  test("a gun into a free slot, and a gun swapped in for the one in hand", () => {
    expect(lootGained(view({}), view({ gun1: RIFLE }))).toEqual([{ kind: "gun", key: "rifle", to: "Rifle", from: "" }]);
    expect(lootGained(view({ gun1: RIFLE }), view({ gun1: SMG }))).toEqual([{ kind: "gun", key: "smg", to: "SMG", from: "Rifle" }]);
    expect(lootGained(view({}), view({ gun0: RIFLE }))[0]?.from).toBe(WEAPONS[PISTOL].name);
  });

  test("grenades: a first stack, more of the same, and an F swap for another type", () => {
    expect(lootGained(view({}), view({ grenades: 2 }))).toEqual([{ kind: "grenade", key: "frag", to: "2 💥 Frag", from: "" }]);
    expect(lootGained(view({ grenades: 1 }), view({ grenades: 3 }))[0]?.to).toBe("2 💥 Frag");
    expect(lootGained(view({ grenades: 2 }), view({ grenades: 1 }, GRENADE_SMOKE))).toEqual([
      { kind: "grenade", key: "smoke", to: "💨 Smoke", from: "💥 Frag" },
    ]);
    // None left of the old type: a plain pickup of the new one.
    expect(lootGained(view({ grenades: 0 }), view({ grenades: 1 }, GRENADE_SMOKE))[0]).toMatchObject({ to: "1 💨 Smoke", from: "" });
  });

  test("healing items and shield charges", () => {
    expect(lootGained(view({ bandages: 1 }), view({ bandages: 3, medkits: 1, shields: 1 }))).toEqual([
      { kind: "heal", key: "bandage", to: "2 Bandage", from: "" },
      { kind: "heal", key: "medkit", to: "1 Medkit", from: "" },
      { kind: "shield", key: "shield", to: "1 Shield charge", from: "" },
    ]);
  });

  test("nothing for what only goes down or moves: a shot, a throw, a heal used, a slot switch", () => {
    expect(lootGained(view({ mag0: 10 }), view({ mag0: 9 }))).toEqual([]);
    expect(lootGained(view({ grenades: 2 }), view({ grenades: 1 }))).toEqual([]);
    expect(lootGained(view({ grenades: 1 }), view({ grenades: 0 }))).toEqual([]);
    expect(lootGained(view({ bandages: 2, shields: 2 }), view({ bandages: 1, shields: 1 }))).toEqual([]);
    expect(lootGained(view({ gun1: RIFLE }), view({ gun1: RIFLE, hand: 1 }))).toEqual([]);
  });
});
