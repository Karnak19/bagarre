// Game modes. One room class on the server (GameRoom) plays all four;
// everything that differs between a duel, a free-for-all, a team
// deathmatch and a battle royale is in the mode's rules below, so the room
// itself has no `if (ffa)` for the numbers. (The royale's own rules, the gun
// slots, the stacks and the zone, are in royale.ts.)

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
  ROYALE_END_DELAY,
  ROYALE_MAX_PLAYERS,
  ROYALE_MIN_PLAYERS,
  ROYALE_ROOM_NAME,
  ROYALE_WARMUP,
  SUDDEN_DEATH_MAX,
  TEAM_COUNTDOWN,
  TEAM_END_DELAY,
  TEAM_KILLS_TO_WIN,
  TEAM_MAX_PLAYERS,
  TEAM_MIN_PER_TEAM,
  TEAM_MIN_PLAYERS,
  TEAM_RESPAWN_DELAY,
  TEAM_ROOM_NAME,
  TEAM_TIME_LIMIT,
  WARMUP_SECONDS,
  ZONE,
} from "./constants.ts";
import { FFA_MAPS, TEAM_MAPS } from "./maps/ffa/index.ts";
import { ROYALE_MAPS } from "./maps/royale/index.ts";
import { MAPS, type MapDef } from "./maps/index.ts";

export type GameMode = "duel" | "ffa" | "tdm" | "royale";

/**
 * What makes a battle royale (ModeRules.royale): one life, the gun slots and
 * counted grenades (royale.ts), crates and items on the floor, and the zone.
 * The timings are here, not in ZONE, so the tests can shorten them.
 */
export interface RoyaleRules {
  /** Seconds after the match starts before the zone shrinks, and when it is closed. */
  zoneWait: number;
  zoneClose: number;
}

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
  /**
   * A tie for the lead at the time limit goes to sudden death (the next kill
   * that breaks it wins) for at most this many seconds; then the match ends
   * and `rank`'s tiebreaks decide. 0 with no time limit (a duel).
   */
  suddenDeathMax: number;
  /**
   * The room's host (the first seated player in join order, see `hostOf`)
   * starts every match with a Start button (MSG_START): no countdown, and no
   * start on its own, not even with every seat taken. False: the match
   * starts on its own once enough players are in (after `countdown`).
   */
  hostStarts: boolean;
  /** Seconds of countdown before a match starts once enough players are in (0: starts at once). Unused with `hostStarts`. */
  countdown: number;
  /**
   * Seconds of warmup once the match starts, before `playing` (see
   * WARMUP_SECONDS): spawned, picks apply at once, no shooting. 0 skips it
   * (a mode where picks are off, like a future gun game).
   */
  warmup: number;
  respawnDelay: number;
  /** Seconds the result stays up before the rematch. */
  endDelay: number;
  /** Players may join a match in progress (they spawn out of everyone's sight). */
  dropIn: boolean;
  /** The map pool. A room never plays a map outside it. */
  maps: readonly MapDef[];
  /**
   * A battle royale (one life, slots, crates, the zone); null in the other
   * modes, which then play exactly as before.
   */
  royale: RoyaleRules | null;
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
  // A duel can't end level: it ends on the first player to KILLS_TO_WIN (one
  // kill at a time), and a player leaving sends the room back to waiting with
  // no result. So no sudden death, and `rank` never has a tie to break.
  suddenDeathMax: 0,
  hostStarts: false,
  countdown: 0,
  warmup: WARMUP_SECONDS,
  respawnDelay: RESPAWN_DELAY,
  endDelay: MATCH_END_DELAY,
  dropIn: false,
  maps: MAPS,
  royale: null,
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
  suddenDeathMax: SUDDEN_DEATH_MAX,
  hostStarts: false,
  countdown: FFA_COUNTDOWN,
  warmup: WARMUP_SECONDS,
  respawnDelay: FFA_RESPAWN_DELAY,
  endDelay: FFA_END_DELAY,
  dropIn: true,
  maps: FFA_MAPS,
  royale: null,
};

/**
 * Team deathmatch: red against blue, up to 4v4 on the FFA maps that have team
 * sides. First team to 25 kills, or the most after 8 minutes (a tie goes to
 * sudden death, then `rank`'s tiebreaks: never a draw). The countdown starts at 2v2 and players drop in up to 4v4.
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
  suddenDeathMax: SUDDEN_DEATH_MAX,
  hostStarts: false,
  countdown: TEAM_COUNTDOWN,
  warmup: WARMUP_SECONDS,
  respawnDelay: TEAM_RESPAWN_DELAY,
  endDelay: TEAM_END_DELAY,
  dropIn: true,
  maps: TEAM_MAPS,
  royale: null,
};

/**
 * Battle royale: 2 to 10 players, every one for themselves, one life each.
 * Everyone starts with the Pistol and no grenades and finds the rest in
 * crates; the zone closes in and the last one standing wins. No kill target
 * and no clock (the zone ends it), no joining once it started, no loadout.
 * The host starts every match, the next one after a result included (`hostStarts`).
 */
export const ROYALE_RULES: ModeRules = {
  mode: "royale",
  roomName: ROYALE_ROOM_NAME,
  minPlayers: ROYALE_MIN_PLAYERS,
  maxPlayers: ROYALE_MAX_PLAYERS,
  // Only read during warmup (below it, back to waiting). Once the match is
  // played, what ends a royale is players ALIVE, not connected: the last one
  // standing wins (GameRoom's checkLastStanding).
  minToContinue: ROYALE_MIN_PLAYERS,
  startNeedsAll: false,
  teams: false,
  minPerTeam: 0,
  killsToWin: 0,
  timeLimit: 0,
  suddenDeathMax: 0,
  // The host presses Start (once ROYALE_MIN_PLAYERS are in), then the warmup.
  hostStarts: true,
  countdown: 0,
  warmup: ROYALE_WARMUP,
  respawnDelay: FFA_RESPAWN_DELAY,
  endDelay: ROYALE_END_DELAY,
  dropIn: false,
  maps: ROYALE_MAPS,
  royale: { zoneWait: ZONE.wait, zoneClose: ZONE.close },
};

export const MODES: Record<GameMode, ModeRules> = { duel: DUEL_RULES, ffa: FFA_RULES, tdm: TEAM_RULES, royale: ROYALE_RULES };

export function isGameMode(v: unknown): v is GameMode {
  return v === "duel" || v === "ffa" || v === "tdm" || v === "royale";
}

/**
 * The host of a room: the first session id in join order that still holds a
 * seat (`seated`), or "" with none. Spectators are never in the join order;
 * a battle royale player who left mid-match keeps a seat for the result but
 * isn't `seated` any more. So when the host leaves, the next one in join
 * order is host at once.
 */
export function hostOf(joinOrder: readonly string[], seated: (id: string) => boolean): string {
  return joinOrder.find(seated) ?? "";
}

/**
 * Whether a start request (MSG_START) starts the match: only in a mode whose
 * host starts it, only while waiting, only from the host, and only with
 * enough players in (`ready`, the room's own check). Anything else is
 * ignored, never an error.
 */
export function acceptsStart(rules: ModeRules, req: { phase: string; sender: string; host: string; ready: boolean }): boolean {
  return rules.hostStarts && req.phase === "waiting" && req.sender !== "" && req.sender === req.host && req.ready;
}

/** The rules of a synced `mode` string; an unknown one reads as a duel. */
export function rulesOf(mode: string): ModeRules {
  return isGameMode(mode) ? MODES[mode] : DUEL_RULES;
}

/**
 * One entry of a ranking: a player, or a team (its kills, its players' damage
 * together). `reachedAt` is the server tick at which `kills` was reached: the
 * tick of the latest kill, or the match start with none.
 */
export interface Standing {
  id: string;
  kills: number;
  /** Damage dealt during the match. */
  damage: number;
  reachedAt: number;
}

/**
 * Why first place won when it was level on kills with second: most damage
 * dealt ("damage"), reached that kill score first ("first"), or the lot
 * ("lot"). "" when it won outright on kills (or was alone). In a battle
 * royale, "kills" too: the last two went out on the same tick and first
 * place had more kills (see rankRoyale).
 */
export type TiebreakReason = "" | "kills" | "damage" | "first" | "lot";

/**
 * FNV-1a (32 bits) of a string: a small, fast hash, the same on the server
 * and the client. The lot of `rank` is drawn with it.
 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** An entry's lot in a match: the lowest wins. Reproducible from the seed (the match id) and the entry's id. */
export function lotOf(seed: string, id: string): number {
  return fnv1a(`${seed}:${id}`);
}

/**
 * The final order of a match, with no draws: every entry gets its own place,
 * 1 to n. Most kills first; entries level on kills are split by, in turn:
 *   1. the most damage dealt,
 *   2. the one who reached that kill score first (earliest `reachedAt`),
 *   3. the lot (`lotOf` the seed, the match id: reproducible, never random).
 * Deaths never count. The same function ranks the players of a duel or an
 * FFA and the two teams of a team deathmatch (and the players within each
 * team), on the server; clients show the places the server synced.
 * `reason` is why the first one won (see TiebreakReason).
 */
export function rank<T extends Standing>(entries: readonly T[], seed: string): { order: { entry: T; place: number }[]; reason: TiebreakReason } {
  const lot = new Map(entries.map((e) => [e.id, lotOf(seed, e.id)]));
  const sorted = [...entries].sort(
    (a, b) =>
      b.kills - a.kills ||
      b.damage - a.damage ||
      a.reachedAt - b.reachedAt ||
      lot.get(a.id)! - lot.get(b.id)! ||
      // Two ids with the same hash: still one order, whatever the input order.
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const [first, second] = sorted;
  const reason: TiebreakReason =
    !first || !second || first.kills !== second.kills
      ? ""
      : first.damage !== second.damage
        ? "damage"
        : first.reachedAt !== second.reachedAt
          ? "first"
          : "lot";
  return { order: sorted.map((entry, i) => ({ entry, place: i + 1 })), reason };
}

/**
 * A battle royale entry: `outTick` is the server tick the player was
 * knocked out on (killed, the zone, or left), 0 for one still standing.
 */
export interface RoyaleStanding {
  id: string;
  outTick: number;
  kills: number;
  damage: number;
}

/**
 * The final order of a battle royale: the order of knock-outs, never the
 * kills. Whoever is still standing is 1st; then the last one out is next,
 * and the first one out is last. Only players knocked out on the same tick
 * (two in the zone, a frag that gets both) are split by a tiebreak: the most
 * kills, then the most damage, then the lot (`lotOf` the match id). Every
 * place is its own, 1 to n. `reason` says why 1st won when it went out on
 * the same tick as 2nd ("kills", "damage", "lot"), else "".
 */
export function rankRoyale<T extends RoyaleStanding>(entries: readonly T[], seed: string): { order: { entry: T; place: number }[]; reason: TiebreakReason } {
  const lot = new Map(entries.map((e) => [e.id, lotOf(seed, e.id)]));
  // Still standing counts as the latest possible knock-out.
  const out = (e: RoyaleStanding) => (e.outTick > 0 ? e.outTick : Number.MAX_SAFE_INTEGER);
  const sorted = [...entries].sort(
    (a, b) =>
      out(b) - out(a) ||
      b.kills - a.kills ||
      b.damage - a.damage ||
      lot.get(a.id)! - lot.get(b.id)! ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const [first, second] = sorted;
  const reason: TiebreakReason =
    !first || !second || out(first) !== out(second)
      ? ""
      : first.kills !== second.kills
        ? "kills"
        : first.damage !== second.damage
          ? "damage"
          : "lot";
  return { order: sorted.map((entry, i) => ({ entry, place: i + 1 })), reason };
}

/** `TiebreakReason` from a synced string (anything unknown reads as "", won outright). */
export function parseTiebreak(v: unknown): TiebreakReason {
  return v === "kills" || v === "damage" || v === "first" || v === "lot" ? v : "";
}

/** "1st", "2nd", "3rd", "4th"... */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
