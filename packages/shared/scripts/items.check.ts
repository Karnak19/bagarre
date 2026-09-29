// Self-check of the item tables (WEAPONS and GRENADES in src/constants.ts):
// the ids that go over the wire never change, keys are unique, and the tables
// fit what carries them. A gun or grenade missing from the client's view
// tables (GUN_VIEW / GRENADE_VIEW, apps/client/src/items.ts) doesn't compile,
// and neither does an effect without a handler (GameRoom's blastEffects).
// Run with `bun run check` (in packages/shared). Exits non-zero on a failure.

import {
  DEFAULT_GRENADE,
  DEFAULT_WEAPON,
  GRENADES,
  GRENADE_FLASH,
  GRENADE_FRAG,
  GRENADE_SMOKE,
  GRENADE_STUN,
  WEAPONS,
} from "../src/constants.ts";
import { KILL_GRENADE } from "../src/protocol.ts";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

/**
 * Every weapon and grenade key, at its id (its index). Append-only: a new
 * item is added at the end of its table AND here. Never reorder, rename or
 * remove a line: these numbers are MSG_PICK, `Player.weapon`,
 * `Player.grenade`, `Grenade.kind` and the kill feed.
 */
const WEAPON_IDS = ["rifle", "shotgun", "sniper", "smg", "revolver", "burst-pistol", "dmr"];
const GRENADE_IDS = ["frag", "smoke", "stun", "flash"];

const weaponKeys = WEAPONS.map((w) => w.key);
const grenadeKeys = GRENADES.map((g) => g.key);
check(weaponKeys.join() === WEAPON_IDS.join(), `weapon ids are frozen, new guns appended (${weaponKeys.join(", ")})`);
check(grenadeKeys.join() === GRENADE_IDS.join(), `grenade ids are frozen, new types appended (${grenadeKeys.join(", ")})`);
check(
  [GRENADE_FRAG, GRENADE_SMOKE, GRENADE_STUN, GRENADE_FLASH].join() === "0,1,2,3" &&
    [GRENADE_FRAG, GRENADE_SMOKE, GRENADE_STUN, GRENADE_FLASH].map((i) => GRENADES[i].key).join() === "frag,smoke,stun,flash",
  "GRENADE_FRAG..GRENADE_FLASH are 0-3 and name their own rows",
);
check(DEFAULT_WEAPON === 0 && DEFAULT_GRENADE === GRENADE_FRAG, "the defaults are the rifle and the frag");

for (const [what, keys] of [
  ["weapon", weaponKeys],
  ["grenade", grenadeKeys],
] as const) {
  check(new Set(keys).size === keys.length, `every ${what} key is unique`);
  check(keys.every((k) => /^[a-z0-9-]+$/.test(k)), `${what} keys are lowercase slugs`);
}

const EFFECTS: readonly string[] = ["damage", "cloud", "stun", "flash"];
const AFFECTS: readonly string[] = ["enemies"];
for (const g of GRENADES) check(EFFECTS.includes(g.effect) && AFFECTS.includes(g.affects), `${g.name}: a known effect (${g.effect}) on a known target (${g.affects})`);

// The carriers: uint8 schema fields, the kill feed's weapon id, the number keys.
check(WEAPONS.length < KILL_GRENADE, `weapon ids stay clear of KILL_GRENADE (${KILL_GRENADE}) in the kill feed`);
check(GRENADES.length <= 256, "grenade ids fit a uint8");
check(WEAPONS.length <= 9, `every weapon has a number key, 1-9 (${WEAPONS.length} weapons)`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall item checks passed");
