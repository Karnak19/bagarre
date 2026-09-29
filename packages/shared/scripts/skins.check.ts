// Self-check of the skin table (src/skins.ts): unique skin ids and files.
// (The guns' models are the client's GUN_VIEW, apps/client/src/items.ts,
// typed so that a gun without one doesn't compile.)
// Run with `bun run check` (in packages/shared). Exits non-zero on a failure.

import { SKINS, isSkinId, randomSkin } from "../src/skins.ts";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

const ids = SKINS.map((s) => s.id);
check(new Set(ids).size === ids.length, `every skin id is unique (${ids.length} skins)`);
check(new Set(SKINS.map((s) => s.file)).size === SKINS.length, "every skin has its own file");
check(ids.every((id) => /^[a-z0-9-]+$/.test(id)), "skin ids are lowercase slugs");
check(!isSkinId("nope") && !isSkinId(undefined) && isSkinId(ids[0]), "isSkinId accepts only listed ids");

// A guest's roll prefers a skin nobody wears, and falls back to any when all are taken.
const taken = ids.slice(0, -1);
check(randomSkin(taken, () => 0.5) === ids[ids.length - 1], "randomSkin picks the one free skin");
check(isSkinId(randomSkin(ids, () => 0.99)), "randomSkin still picks a skin when all are taken");

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall skin checks passed");
