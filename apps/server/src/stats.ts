// What a finished match writes into the stats (GameRoom.recordStats), as a
// pure function so the rules are tested without a room (stats.test.ts).

import { NO_TEAM, matchRecorded, type ModeRules } from "@bagarre/shared";
import type { Identity, MatchResult } from "./accounts.ts";

/** One seat at the end of a match: who it is and how it did. */
export interface SeatOutcome {
  identity: Identity;
  /** Final place, 1 = first (Player.place). */
  place: number;
  kills: number;
  deaths: number;
  team: number;
}

/**
 * The rows to record for a finished match: one per account player (guests
 * and bots are skipped), with the place they finished in among every seat,
 * bots included (finishing behind a bot still counts). A win is first place,
 * or the winning team; anything else is a loss. Null when the match isn't
 * recorded at all (`matchRecorded`): a battle royale started by too few
 * humans (`humanStarters`, ignored in the other modes), or a duel against a
 * bot.
 */
export function matchResults(rules: ModeRules, seats: Iterable<SeatOutcome>, humanStarters: number, winningTeam = NO_TEAM): MatchResult[] | null {
  const all = [...seats];
  const bots = all.filter((s) => s.identity.kind === "bot").length;
  if (!matchRecorded(rules, { humanStarters, bots })) return null;
  const results: MatchResult[] = [];
  for (const { identity, place, kills, deaths, team } of all) {
    if (identity.kind !== "account") continue;
    // Teams: a win for everyone on the winning team, a loss for the others.
    if (rules.teams) results.push({ userId: identity.userId, kills, deaths, won: team === winningTeam, place, team });
    else results.push({ userId: identity.userId, kills, deaths, won: place === 1, place });
  }
  return results;
}
