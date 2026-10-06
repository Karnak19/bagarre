// Tests of what a finished match writes into the stats (stats.ts), bots
// included: a battle royale with bots is recorded only when enough humans
// started it, and then every account's place counts the bots that finished
// ahead of it; a duel against a bot never is; an FFA or a team deathmatch
// with bots records the humans only.
// Run with `bun run test` (or `bun test src/stats.test.ts` in apps/server).

import { describe, expect, test } from "bun:test";
import { DUEL_RULES, FFA_RULES, NO_TEAM, ROYALE_RULES, TEAM_BLUE, TEAM_RED, TEAM_RULES } from "@bagarre/shared";
import type { Identity } from "./accounts.ts";
import { botName } from "./bots.ts";
import { matchResults, type SeatOutcome } from "./stats.ts";

const account = (userId: string): Identity => ({ kind: "account", name: userId, userId, username: userId, skin: null });
const guest = (name: string): Identity => ({ kind: "guest", name });
const bot = (name: string): Identity => ({ kind: "bot", name });
const seat = (identity: Identity, place: number, kills = 0, deaths = 1): SeatOutcome => ({ identity, place, kills, deaths, team: NO_TEAM });

describe("matchResults: a battle royale with bots", () => {
  test("three humans and bots: recorded, each account at the place they finished, bots ahead of them included", () => {
    const seats = [
      seat(bot("Bot Ada"), 1, 3, 0),
      seat(account("ann"), 2, 2),
      seat(bot("Bot Rex"), 3),
      seat(guest("Guest-1234"), 4),
      seat(account("bob"), 5),
      seat(bot("Bot Ivy"), 6),
    ];
    // Six started it, three of them people.
    const results = matchResults(ROYALE_RULES, seats, 3);
    expect(results).toEqual([
      { userId: "ann", kills: 2, deaths: 1, won: false, place: 2 },
      { userId: "bob", kills: 0, deaths: 1, won: false, place: 5 },
    ]);
  });

  test("an account first, ahead of the bots: a win", () => {
    const seats = [seat(account("ann"), 1, 4, 0), seat(bot("Bot Ada"), 2), seat(account("bob"), 3), seat(guest("Guest-1234"), 4)];
    expect(matchResults(ROYALE_RULES, seats, 3)?.find((r) => r.userId === "ann")?.won).toBe(true);
  });

  test("two humans and eight bots: not recorded, the bots don't make up the number", () => {
    const seats = [seat(account("ann"), 1, 9, 0), seat(account("bob"), 2)];
    for (let i = 0; i < 8; i++) seats.push(seat(bot(`Bot ${i}`), 3 + i));
    expect(matchResults(ROYALE_RULES, seats, 2)).toBeNull();
  });

  test("one human alone with bots: not recorded", () => {
    expect(matchResults(ROYALE_RULES, [seat(account("ann"), 1), seat(bot("Bot Ada"), 2)], 1)).toBeNull();
  });

  test("bots are never recorded themselves", () => {
    const results = matchResults(ROYALE_RULES, [seat(bot("Bot Ada"), 1), seat(account("a"), 2), seat(account("b"), 3), seat(account("c"), 4)], 3) ?? [];
    expect(results.map((r) => r.userId)).toEqual(["a", "b", "c"]);
  });
});

describe("matchResults: the other modes", () => {
  test("an FFA is recorded whatever the human count, guests skipped", () => {
    const results = matchResults(FFA_RULES, [seat(account("ann"), 1, 5, 0), seat(guest("Guest-1234"), 2), seat(account("bob"), 3)], 0);
    expect(results?.map((r) => [r.userId, r.won])).toEqual([
      ["ann", true],
      ["bob", false],
    ]);
  });
});

describe("matchResults: bots in a duel, an FFA, a team deathmatch", () => {
  test("a duel against a bot: never recorded, won or lost", () => {
    expect(matchResults(DUEL_RULES, [seat(account("ann"), 1, 2, 0), seat(bot("Bot Ada"), 2)], 1)).toBeNull();
    expect(matchResults(DUEL_RULES, [seat(bot("Bot Ada"), 1, 2, 0), seat(account("ann"), 2)], 1)).toBeNull();
  });

  test("a duel between two people: recorded as before", () => {
    expect(matchResults(DUEL_RULES, [seat(account("ann"), 1, 2, 0), seat(account("bob"), 2)], 0)?.map((r) => [r.userId, r.won])).toEqual([
      ["ann", true],
      ["bob", false],
    ]);
  });

  test("an FFA with bots: the humans recorded at the place they finished, bots ahead of them included; the bots never", () => {
    const seats = [seat(bot("Bot Ada"), 1, 5, 0), seat(account("ann"), 2, 3), seat(bot("Bot Rex"), 3), seat(account("bob"), 4)];
    expect(matchResults(FFA_RULES, seats, 0)).toEqual([
      { userId: "ann", kills: 3, deaths: 1, won: false, place: 2 },
      { userId: "bob", kills: 0, deaths: 1, won: false, place: 4 },
    ]);
  });

  test("a team deathmatch with bots: the humans on the winning team win, the bots are never recorded", () => {
    const team = (identity: Identity, place: number, t: number): SeatOutcome => ({ ...seat(identity, place), team: t });
    const seats = [team(bot("Bot Ada"), 1, TEAM_RED), team(account("ann"), 2, TEAM_RED), team(account("bob"), 3, TEAM_BLUE), team(bot("Bot Rex"), 4, TEAM_BLUE)];
    expect(matchResults(TEAM_RULES, seats, 0, TEAM_RED)?.map((r) => [r.userId, r.won, r.team])).toEqual([
      ["ann", true, TEAM_RED],
      ["bob", false, TEAM_BLUE],
    ]);
  });
});

describe("botName", () => {
  test("the first name nobody has, never a guest's", () => {
    expect(botName(new Set())).toBe("Bot Ada");
    expect(botName(new Set(["Bot Ada", "Guest-1234"]))).toBe("Bot Rex");
  });
  test("every listed name taken: a numbered one", () => {
    const taken = new Set(["Bot Ada", "Bot Rex", "Bot Ivy", "Bot Max", "Bot Zoe", "Bot Leo", "Bot Kit", "Bot Sam", "Bot Uma", "Bot Ned"]);
    expect(botName(taken)).toBe("Bot 11");
  });
});
