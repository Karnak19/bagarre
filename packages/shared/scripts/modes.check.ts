// Self-check of `rank` (src/modes.ts), the tiebreak chain that means a match
// is never a draw: kills, then damage, then first to the score, then the lot.
// Run with `bun run check` (in packages/shared). Exits non-zero on a failure.

import { lotOf, rank, type Standing } from "../src/modes.ts";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

const s = (id: string, kills: number, damage = 0, reachedAt = 0): Standing => ({ id, kills, damage, reachedAt });
const ids = (r: ReturnType<typeof rank>) => r.order.map((o) => o.entry.id).join(",");
const places = (r: ReturnType<typeof rank>) => r.order.map((o) => o.place).join(",");

// Kills first: an outright win, no tiebreak.
const outright = rank([s("a", 3, 0), s("b", 5, 0), s("c", 1, 900)], "m1");
check(ids(outright) === "b,a,c" && outright.reason === "", `most kills wins outright (${ids(outright)}, "${outright.reason}")`);

// 1. Level on kills: the most damage.
const dmg = rank([s("a", 4, 300, 10), s("b", 4, 500, 90), s("c", 2)], "m1");
check(ids(dmg) === "b,a,c" && dmg.reason === "damage", `level on kills: the most damage wins (${ids(dmg)}, "${dmg.reason}")`);

// 2. Level on kills and damage: the first to reach that kill score.
const first = rank([s("a", 4, 300, 90), s("b", 4, 300, 40)], "m1");
check(ids(first) === "b,a" && first.reason === "first", `then the first to the score wins (${ids(first)}, "${first.reason}")`);

// 3. Level on everything (0-0, no damage): the lot, reproducible from the match id.
const tied = [s("a", 0), s("b", 0), s("c", 0)];
const lot = rank(tied, "room:match-1");
const expected = [...tied].sort((x, y) => lotOf("room:match-1", x.id) - lotOf("room:match-1", y.id))[0].id;
check(lot.order[0].entry.id === expected && lot.reason === "lot", `then the lot (${ids(lot)}, "${lot.reason}", expected ${expected} first)`);
check(ids(rank([...tied].reverse(), "room:match-1")) === ids(lot), "the lot doesn't depend on the input order");
const seeds = new Set(Array.from({ length: 20 }, (_, i) => rank(tied, `room:match-${i}`).order[0].entry.id));
check(seeds.size > 1, `another match id can draw another winner (${[...seeds].join(",")} over 20 seeds)`);

// Deaths are not a tiebreak any more: nothing but kills, damage, reach tick and the lot.
check(!("deaths" in dmg.order[0].entry), "a standing has no deaths");

// Places: always unique, 1 to n.
check(places(lot) === "1,2,3" && places(dmg) === "1,2,3", `unique places 1..n (${places(lot)})`);
const one = rank([s("solo", 0)], "m");
check(one.order[0].place === 1 && one.reason === "", "alone: 1st, won outright");
check(rank([], "m").order.length === 0 && rank([], "m").reason === "", "nobody: an empty order");

// Teams use the same function: team totals.
const teams = rank([s("0", 12, 2400, 500), s("1", 12, 2400, 480)], "room:tdm");
check(teams.order[0].entry.id === "1" && teams.reason === "first", `teams level on kills and damage: first to the score (${ids(teams)})`);

if (failures.length > 0) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nrank: all checks passed");
