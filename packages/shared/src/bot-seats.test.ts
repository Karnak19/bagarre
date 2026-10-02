// Tests of the battle royale's bot seats (modes.ts): which add / remove
// requests are honoured (`acceptsBot`) and which matches with bots go into the
// stats (`royaleRecorded`).
// Run with `bun run test` (or `bun test src/bot-seats.test.ts` in packages/shared).

import { describe, expect, test } from "bun:test";
import { ROYALE_MAX_PLAYERS, ROYALE_MIN_RECORDED } from "./constants.ts";
import { parseBotRequest } from "./messages.ts";
import { DUEL_RULES, FFA_RULES, ROYALE_RULES, TEAM_RULES, acceptsBot, royaleRecorded } from "./modes.ts";

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
  test("no bots outside the battle royale", () => {
    for (const rules of [DUEL_RULES, FFA_RULES, TEAM_RULES]) {
      expect(acceptsBot(rules, add)).toBe(false);
      expect(acceptsBot(rules, remove)).toBe(false);
    }
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

describe("parseBotRequest", () => {
  test("a plain object, its fields ignored", () => {
    expect(parseBotRequest({})).toEqual({});
    expect(parseBotRequest({ id: "bot:1" })).toEqual({});
  });
  test("anything else is refused", () => {
    for (const raw of [null, undefined, 1, "bot", [], true]) expect(parseBotRequest(raw)).toBeNull();
  });
});
