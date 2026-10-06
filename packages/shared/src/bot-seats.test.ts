// Tests of the bot seats (modes.ts), in every mode: which add / remove
// requests are honoured (`acceptsBot`) and which matches with bots go into the
// stats (`royaleRecorded`, `matchRecorded`).
// Run with `bun run test` (or `bun test src/bot-seats.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import { FFA_MAX_PLAYERS, MAX_PLAYERS, ROYALE_MAX_PLAYERS, ROYALE_MIN_RECORDED, TEAM_MAX_PLAYERS } from "./constants.ts";
import { parseBotRequest } from "./messages.ts";
import { DUEL_RULES, FFA_RULES, ROYALE_RULES, TEAM_RULES, acceptsBot, matchRecorded, royaleRecorded } from "./modes.ts";

describe("acceptsBot", () => {
  const add = { add: true, phase: "waiting", sender: "a", host: "a", seats: 1 };
  const remove = { ...add, add: false };
  test("the host, waiting, with a seat free: adds", () => {
    expect(acceptsBot(ROYALE_RULES, add)).toBe(true);
    expect(acceptsBot(ROYALE_RULES, { ...add, seats: ROYALE_MAX_PLAYERS - 1 })).toBe(true);
  });
  test("every seat taken (or promised): no bot added", () => {
    expect(acceptsBot(ROYALE_RULES, { ...add, seats: ROYALE_MAX_PLAYERS })).toBe(false);
  });
  test("not the host: ignored, adding or removing", () => {
    expect(acceptsBot(ROYALE_RULES, { ...add, sender: "b" })).toBe(false);
    expect(acceptsBot(ROYALE_RULES, { ...remove, sender: "b" })).toBe(false);
  });
  test("no host (an empty sender never matches an empty host)", () => {
    expect(acceptsBot(ROYALE_RULES, { ...add, sender: "", host: "" })).toBe(false);
  });
  test("adding outside the waiting phase: ignored; removing works in any phase", () => {
    for (const phase of ["warmup", "playing", "ended"]) {
      expect(acceptsBot(ROYALE_RULES, { ...add, phase })).toBe(false);
      expect(acceptsBot(ROYALE_RULES, { ...remove, phase })).toBe(true);
    }
  });
  test("every mode takes bots, up to its own seat cap: a duel's second seat, an FFA's, a team deathmatch's", () => {
    for (const [rules, max] of [
      [DUEL_RULES, MAX_PLAYERS],
      [FFA_RULES, FFA_MAX_PLAYERS],
      [TEAM_RULES, TEAM_MAX_PLAYERS],
    ] as const) {
      expect(acceptsBot(rules, { ...add, seats: max - 1 })).toBe(true);
      expect(acceptsBot(rules, { ...add, seats: max })).toBe(false);
      expect(acceptsBot(rules, { ...add, sender: "b" })).toBe(false);
      expect(acceptsBot(rules, { ...remove, sender: "b" })).toBe(false);
      for (const phase of ["warmup", "playing", "ended"]) {
        expect(acceptsBot(rules, { ...add, phase })).toBe(false);
        expect(acceptsBot(rules, { ...remove, phase })).toBe(true);
      }
    }
    // A duel: the host alone in it adds one bot, the second never.
    expect(MAX_PLAYERS).toBe(2);
    expect(acceptsBot(DUEL_RULES, { ...add, seats: 1 })).toBe(true);
    expect(acceptsBot(DUEL_RULES, { ...add, seats: 2 })).toBe(false);
  });
});

describe("royaleRecorded", () => {
  test("enough humans started it: recorded, however many bots", () => {
    expect(royaleRecorded(ROYALE_MIN_RECORDED)).toBe(true);
    expect(royaleRecorded(ROYALE_MAX_PLAYERS)).toBe(true);
  });
  test("too few humans: not recorded, bots don't make up the number", () => {
    expect(royaleRecorded(ROYALE_MIN_RECORDED - 1)).toBe(false);
    expect(royaleRecorded(1)).toBe(false);
  });
});

describe("matchRecorded", () => {
  test("a duel with a bot in it: never recorded; without one, as before", () => {
    expect(matchRecorded(DUEL_RULES, { humanStarters: 1, bots: 1 })).toBe(false);
    expect(matchRecorded(DUEL_RULES, { humanStarters: 2, bots: 0 })).toBe(true);
  });
  test("an FFA or a team deathmatch: recorded, bots or not (only the humans' rows are written)", () => {
    for (const rules of [FFA_RULES, TEAM_RULES]) {
      expect(matchRecorded(rules, { humanStarters: 1, bots: 5 })).toBe(true);
      expect(matchRecorded(rules, { humanStarters: 3, bots: 0 })).toBe(true);
    }
  });
  test("a battle royale: royaleRecorded on the humans who started it, whatever the bots", () => {
    expect(matchRecorded(ROYALE_RULES, { humanStarters: ROYALE_MIN_RECORDED, bots: 7 })).toBe(true);
    expect(matchRecorded(ROYALE_RULES, { humanStarters: ROYALE_MIN_RECORDED - 1, bots: 0 })).toBe(false);
  });
});

describe("parseBotRequest", () => {
  test("a plain object, its fields ignored", () => {
    expect(parseBotRequest({})).toEqual({});
    expect(parseBotRequest({ id: "bot:1" })).toEqual({});
  });
  test("anything else is refused", () => {
    for (const raw of [null, undefined, 1, "bot", [], true]) expect(parseBotRequest(raw)).toBeNull();
  });
});
