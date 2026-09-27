// The scoreboard's content: held open with Tab in a match, and part of the
// match result card (drawn by ui/game/Scoreboard.tsx). Everything on it comes
// from the synced room state (the server counts shots, hits, damage and
// measures ping). Pure: no DOM.

import { NO_TEAM, TEAM_BLUE, TEAM_NAMES, TEAM_RED, TICK_RATE, WEAPONS, findMap, ordinal, placements, type GameMode, type PlayerView } from "@bagarre/shared";
import type { Snapshot } from "./net.ts";
import { TEAM_PAINT, paintOf } from "./paint.ts";

export const COLUMNS = [
  { key: "kills", label: "Kills", short: "K" },
  { key: "deaths", label: "Deaths", short: "D" },
  { key: "damage", label: "Damage", short: "Dmg" },
  { key: "acc", label: "Accuracy", short: "Acc" },
  { key: "weapon", label: "Weapon", short: "Gun" },
  { key: "ping", label: "Ping", short: "Ping" },
] as const;

/** Seconds as "m:ss". */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds left of a snapshot's time limit (null: no limit, or not running). */
export function secondsLeft(s: Snapshot | null): number | null {
  if (!s || s.timeLimit <= 0 || s.phase === "waiting") return null;
  const elapsed = ((s.endTick || s.tick) - s.startTick) / TICK_RATE;
  return Math.max(0, s.timeLimit - elapsed);
}

export interface ScoreboardRow {
  id: string;
  name: string;
  /** Paint index (paint.ts): the seat's colour, or the team's with teams. */
  slot: number;
  /** TEAM_RED / TEAM_BLUE, NO_TEAM outside a team mode. */
  team: number;
  you: boolean;
  /** Final place so far (kills, then deaths; equal players share it), and as "1st". */
  place: number;
  placeLabel: string;
  /** Most kills, alone at the top. */
  leader: boolean;
  account: boolean;
  /** Lost connection, seat held. */
  away: boolean;
  kills: number;
  deaths: number;
  damage: number;
  shots: number;
  hits: number;
  /** "62%", or "–" before the first shot. */
  accuracy: string;
  weapon: string;
  /** "34 ms", or "–" before the first measure. */
  ping: string;
}

export interface ScoreboardModel {
  mode: GameMode;
  mapName: string;
  killsToWin: number;
  /** Duel: our kills, then theirs. */
  score: [number, number];
  /** Match time, "m:ss". */
  time: string;
  /** FFA: time left, "m:ss" ("" with no limit). */
  timeLeft: string;
  suddenDeath: boolean;
  /** By place: most kills first, then fewest deaths. */
  rows: ScoreboardRow[];
  /**
   * Team deathmatch: the two teams, red then blue, each with its score (the
   * team's kills), its rows by place within the team, and whether it won.
   * Null in the other modes.
   */
  teams: ScoreboardTeam[] | null;
  /** Our team (NO_TEAM: none, or watching). */
  youTeam: number;
  /** The winning team once the match ended (NO_TEAM: a draw, not over, or no teams). */
  winningTeam: number;
}

export interface ScoreboardTeam {
  team: number;
  /** "Red" / "Blue". */
  name: string;
  /** Paint index of the team colour. */
  slot: number;
  score: number;
  /** Kills and deaths of the players on it right now. */
  kills: number;
  deaths: number;
  you: boolean;
  won: boolean;
  rows: ScoreboardRow[];
}

/** The scoreboard's content, from a snapshot (pure: no DOM). `you` is our session id. */
export function scoreboardModel(s: Snapshot | null, you: string): ScoreboardModel {
  const players: (PlayerView & { id: string })[] = [];
  s?.players.forEach((p, id) => players.push({ ...p, id }));
  // Equal players keep a stable order (by seat).
  players.sort((a, b) => a.slot - b.slot);
  const placed = placements(players);
  const mine = s?.players.get(you);
  const theirs = players.find((p) => p.id !== you);
  const top = placed[0]?.player.kills ?? 0;
  const alone = players.filter((p) => p.kills === top).length === 1;
  const running = !!s && s.phase !== "waiting";
  const left = secondsLeft(s);
  const row = ({ player: p, place }: { player: PlayerView & { id: string }; place: number }): ScoreboardRow => ({
    id: p.id,
    name: p.name,
    slot: paintOf(p),
    team: p.team,
    you: p.id === you,
    place,
    placeLabel: ordinal(place),
    leader: top > 0 && alone && p.kills === top,
    account: p.account,
    away: !p.connected,
    kills: p.kills,
    deaths: p.deaths,
    damage: p.damage,
    shots: p.shots,
    hits: p.hits,
    accuracy: p.shots > 0 ? `${Math.round((100 * p.hits) / p.shots)}%` : "–",
    weapon: WEAPONS[p.weapon]?.name ?? "",
    ping: p.ping > 0 ? `${p.ping} ms` : "–",
  });
  const ended = s?.phase === "ended";
  const winningTeam = ended ? (s?.winningTeam ?? NO_TEAM) : NO_TEAM;
  const youTeam = mine?.team ?? NO_TEAM;
  const teams =
    s?.mode === "tdm"
      ? [TEAM_RED, TEAM_BLUE].map((team): ScoreboardTeam => {
          const on = players.filter((p) => p.team === team);
          return {
            team,
            name: TEAM_NAMES[team],
            slot: TEAM_PAINT[team],
            score: team === TEAM_RED ? s.redScore : s.blueScore,
            kills: on.reduce((n, p) => n + p.kills, 0),
            deaths: on.reduce((n, p) => n + p.deaths, 0),
            you: youTeam === team,
            won: winningTeam === team,
            // The leader mark is the team's best player here, not the whole room's.
            rows: placements(on).map((pl) => ({ ...row(pl), leader: false })),
          };
        })
      : null;
  return {
    mode: s?.mode ?? "duel",
    mapName: s ? (findMap(s.mapId)?.name ?? "") : "",
    killsToWin: s?.killsToWin ?? 0,
    score: [mine?.kills ?? 0, theirs?.kills ?? 0],
    time: running ? clock(((s.endTick || s.tick) - s.startTick) / TICK_RATE) : "0:00",
    timeLeft: left === null ? "" : clock(Math.ceil(left)),
    suddenDeath: !!s?.suddenDeath,
    rows: placed.map(row),
    teams,
    youTeam,
    winningTeam,
  };
}
