// Game modes. One room class on the server (GameRoom) plays both; everything
// that differs between a duel and a free-for-all is in the mode's rules
// below, so the room itself has no `if (ffa)` for the numbers.

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
} from "./constants.ts";
import { FFA_MAPS } from "./maps/ffa/index.ts";
import { MAPS, type MapDef } from "./maps/index.ts";

export type GameMode = "duel" | "ffa";

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
  /** Kills that win the match at once. */
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
  killsToWin: FFA_KILLS_TO_WIN,
  timeLimit: FFA_TIME_LIMIT,
  countdown: FFA_COUNTDOWN,
  respawnDelay: FFA_RESPAWN_DELAY,
  endDelay: FFA_END_DELAY,
  dropIn: true,
  maps: FFA_MAPS,
};

export const MODES: Record<GameMode, ModeRules> = { duel: DUEL_RULES, ffa: FFA_RULES };

export function isGameMode(v: unknown): v is GameMode {
  return v === "duel" || v === "ffa";
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
