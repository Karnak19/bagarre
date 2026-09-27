// Game modes. One room class on the server (GameRoom) plays all three;
// everything that differs between a duel, a free-for-all and a team
// deathmatch is in the mode's rules below, so the room itself has no
// `if (ffa)` for the numbers.

import {
  FFA_COUNTDOWN,
  FFA_END_DELAY,
  FFA_KILLS_TO_WIN,
  FFA_MAX_PLAYERS,
  FFA_MIN_PLAYERS,
  FFA_MIN_TO_CONTINUE,
  FFA_RESPAWN_DELAY,
  FFA_ROOM_NAME,
  FFA_TIME_LIMIT,
  KILLS_TO_WIN,
  MATCH_END_DELAY,
  MAX_PLAYERS,
  RESPAWN_DELAY,
  ROOM_NAME,
  TEAM_COUNTDOWN,
  TEAM_END_DELAY,
  TEAM_KILLS_TO_WIN,
  TEAM_MAX_PLAYERS,
  TEAM_MIN_PER_TEAM,
  TEAM_MIN_PLAYERS,
  TEAM_RESPAWN_DELAY,
  TEAM_ROOM_NAME,
  TEAM_TIME_LIMIT,
} from "./constants.ts";
import { FFA_MAPS, TEAM_MAPS } from "./maps/ffa/index.ts";
import { MAPS, type MapDef } from "./maps/index.ts";

export type GameMode = "duel" | "ffa" | "tdm";

export interface ModeRules {
  mode: GameMode;
  /** Matchmaking room name. */
  roomName: string;
  /** Players needed to start a match. */
  minPlayers: number;
  /** Player seats. Clients past this can't take one (see the seat model in GameRoom). */
  maxPlayers: number;
  /** Mid-match, fewer players than this ends the match. */
  minToContinue: number;
  /** A duel only starts (and rematches) when every seat is connected; an FFA starts on the connected ones. */
  startNeedsAll: boolean;
  /**
   * Red against blue (team deathmatch): every seat is on a team, the kills
   * count for the team, teammates can't hurt each other. False: every player
   * for themselves.
   */
  teams: boolean;
  /** With teams: connected players each team needs for a match to start (0 without teams). */
  minPerTeam: number;
  /** Kills that win the match at once (a team's kills, with teams). */
  killsToWin: number;
  /** Seconds before the most kills wins (0: no time limit). */
  timeLimit: number;
  /** Seconds of countdown before a match starts once enough players are in (0: starts at once). */
  countdown: number;
  respawnDelay: number;
  /** Seconds the result stays up before the rematch. */
  endDelay: number;
  /** Players may join a match in progress (they spawn out of everyone's sight). */
  dropIn: boolean;
  /** The map pool. A room never plays a map outside it. */
  maps: readonly MapDef[];
}

export const DUEL_RULES: ModeRules = {
  mode: "duel",
  roomName: ROOM_NAME,
  minPlayers: MAX_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  minToContinue: MAX_PLAYERS,
  startNeedsAll: true,
  teams: false,
  minPerTeam: 0,
  killsToWin: KILLS_TO_WIN,
  timeLimit: 0,
  countdown: 0,
  respawnDelay: RESPAWN_DELAY,
  endDelay: MATCH_END_DELAY,
  dropIn: false,
  maps: MAPS,
};

export const FFA_RULES: ModeRules = {
  mode: "ffa",
  roomName: FFA_ROOM_NAME,
  minPlayers: FFA_MIN_PLAYERS,
  maxPlayers: FFA_MAX_PLAYERS,
  minToContinue: FFA_MIN_TO_CONTINUE,
  startNeedsAll: false,
  teams: false,
  minPerTeam: 0,
  killsToWin: FFA_KILLS_TO_WIN,
  timeLimit: FFA_TIME_LIMIT,
  countdown: FFA_COUNTDOWN,
  respawnDelay: FFA_RESPAWN_DELAY,
  endDelay: FFA_END_DELAY,
  dropIn: true,
  maps: FFA_MAPS,
};

/**
 * Team deathmatch: red against blue, up to 4v4 on the FFA maps that have team
 * sides. First team to 25 kills, or the most after 8 minutes (a tie goes to
 * sudden death). The countdown starts at 2v2 and players drop in up to 4v4.
 */
export const TEAM_RULES: ModeRules = {
  mode: "tdm",
  roomName: TEAM_ROOM_NAME,
  minPlayers: TEAM_MIN_PLAYERS,
  maxPlayers: TEAM_MAX_PLAYERS,
  minToContinue: 2,
  startNeedsAll: false,
  teams: true,
  minPerTeam: TEAM_MIN_PER_TEAM,
  killsToWin: TEAM_KILLS_TO_WIN,
  timeLimit: TEAM_TIME_LIMIT,
  countdown: TEAM_COUNTDOWN,
  respawnDelay: TEAM_RESPAWN_DELAY,
  endDelay: TEAM_END_DELAY,
  dropIn: true,
  maps: TEAM_MAPS,
};

export const MODES: Record<GameMode, ModeRules> = { duel: DUEL_RULES, ffa: FFA_RULES, tdm: TEAM_RULES };

export function isGameMode(v: unknown): v is GameMode {
  return v === "duel" || v === "ffa" || v === "tdm";
}

/** The rules of a synced `mode` string; an unknown one reads as a duel. */
export function rulesOf(mode: string): ModeRules {
  return isGameMode(mode) ? MODES[mode] : DUEL_RULES;
}

export interface Standing {
  id: string;
  kills: number;
  deaths: number;
}

/**
 * Final places: most kills first, then fewest deaths. Players equal on both
 * share a place (1, 1, 3...). Used by the server for the result and the stats,
 * and by the client for the placement table, so both agree.
 */
export function placements<T extends Standing>(players: readonly T[]): { player: T; place: number }[] {
  const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const out: { player: T; place: number }[] = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    const tied = prev && prev.player.kills === p.kills && prev.player.deaths === p.deaths;
    out.push({ player: p, place: tied ? prev.place : i + 1 });
  });
  return out;
}

/** "1st", "2nd", "3rd", "4th"... */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
