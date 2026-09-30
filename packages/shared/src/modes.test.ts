// Tests of `rank` (modes.ts), the tiebreak chain that means a match is never
// a draw: kills, then damage, then first to the score, then the lot.
// Run with `bun run test` (or `bun test src/modes.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import { lotOf, rank, type Standing } from "./modes.ts";

const s = (id: string, kills: number, damage = 0, reachedAt = 0): Standing => ({ id, kills, damage, reachedAt });
const ids = (r: ReturnType<typeof rank>) => r.order.map((o) => o.entry.id).join(",");
const places = (r: ReturnType<typeof rank>) => r.order.map((o) => o.place).join(",");

describe("rank", () => {
  // Kills first: an outright win, no tiebreak.
  const outright = rank([s("a", 3, 0), s("b", 5, 0), s("c", 1, 900)], "m1");
  test(`most kills wins outright (${ids(outright)}, "${outright.reason}")`, () => {
    expect(ids(outright)).toBe("b,a,c");
    expect(outright.reason).toBe("");
  });

  // 1. Level on kills: the most damage.
  const dmg = rank([s("a", 4, 300, 10), s("b", 4, 500, 90), s("c", 2)], "m1");
  test(`level on kills: the most damage wins (${ids(dmg)}, "${dmg.reason}")`, () => {
    expect(ids(dmg)).toBe("b,a,c");
    expect(dmg.reason).toBe("damage");
  });

  // 2. Level on kills and damage: the first to reach that kill score.
  const first = rank([s("a", 4, 300, 90), s("b", 4, 300, 40)], "m1");
  test(`then the first to the score wins (${ids(first)}, "${first.reason}")`, () => {
    expect(ids(first)).toBe("b,a");
    expect(first.reason).toBe("first");
  });

  // 3. Level on everything (0-0, no damage): the lot, reproducible from the match id.
  const tied = [s("a", 0), s("b", 0), s("c", 0)];
  const lot = rank(tied, "room:match-1");
  const expected = [...tied].sort((x, y) => lotOf("room:match-1", x.id) - lotOf("room:match-1", y.id))[0].id;
  test(`then the lot (${ids(lot)}, "${lot.reason}", expected ${expected} first)`, () => {
    expect(lot.order[0].entry.id).toBe(expected);
    expect(lot.reason).toBe("lot");
  });
  test("the lot doesn't depend on the input order", () => {
    expect(ids(rank([...tied].reverse(), "room:match-1"))).toBe(ids(lot));
  });
  const seeds = new Set(Array.from({ length: 20 }, (_, i) => rank(tied, `room:match-${i}`).order[0].entry.id));
  test(`another match id can draw another winner (${[...seeds].join(",")} over 20 seeds)`, () => {
    expect(seeds.size).toBeGreaterThan(1);
  });

  // Deaths are not a tiebreak any more: nothing but kills, damage, reach tick and the lot.
  test("a standing has no deaths", () => {
    expect(dmg.order[0].entry).not.toHaveProperty("deaths");
  });

  // Places: always unique, 1 to n.
  test(`unique places 1..n (${places(lot)})`, () => {
    expect(places(lot)).toBe("1,2,3");
    expect(places(dmg)).toBe("1,2,3");
  });
  test("alone: 1st, won outright", () => {
    const one = rank([s("solo", 0)], "m");
    expect(one.order[0].place).toBe(1);
    expect(one.reason).toBe("");
  });
  test("nobody: an empty order", () => {
    expect(rank([], "m").order).toHaveLength(0);
    expect(rank([], "m").reason).toBe("");
  });

  // Teams use the same function: team totals.
  const teams = rank([s("0", 12, 2400, 500), s("1", 12, 2400, 480)], "room:tdm");
  test(`teams level on kills and damage: first to the score (${ids(teams)})`, () => {
    expect(teams.order[0].entry.id).toBe("1");
    expect(teams.reason).toBe("first");
  });
});
