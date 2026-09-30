// The scoreboard's content: held open with Tab in a match, and part of the
// match result card (drawn by ui/game/Scoreboard.tsx). Everything on it comes
// from the synced room state (the server counts shots, hits, damage and
// measures ping). Pure: no DOM.

import { NO_TEAM, TEAM_BLUE, TEAM_NAMES, TEAM_RED, TICK_RATE, WEAPONS, findMap, ordinal, type GameMode, type PlayerView } from "@bagarre/shared";
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

/**
 * Players by place. Once the match ended: the places the server synced
 * (`PlayerView.place`, all different: the server alone knows the tiebreaks,
 * see `rank` in @bagarre/shared); anyone without one (joined after the end)
 * goes last. While it runs: a live order, most kills then most damage, one
 * place each. Equal players keep their input order (by seat, see callers).
 */
export function byPlace<T extends PlayerView>(players: readonly T[], ended: boolean, royale = false): { player: T; place: number }[] {
  const last = (p: PlayerView) => p.place || Number.MAX_SAFE_INTEGER;
  // Battle royale, while it runs: those still in first (by kills), then the
  // ones out, the last out first (the order their places will follow).
  const out = (p: PlayerView) => (p.alive ? Number.MAX_SAFE_INTEGER : p.outTick);
  const live = royale ? (a: T, b: T) => out(b) - out(a) || b.kills - a.kills || b.damage - a.damage : (a: T, b: T) => b.kills - a.kills || b.damage - a.damage;
  const sorted = [...players].sort(ended ? (a, b) => last(a) - last(b) : live);
  return sorted.map((player, i) => ({ player, place: ended && player.place ? player.place : i + 1 }));
}

/** The match clock is running (or stopped at the end): not while waiting, nor during warmup. */
export function clockRuns(s: Snapshot): boolean {
  return s.phase === "playing" || s.phase === "ended";
}

/**
 * Whole seconds left of the warmup, from the synced end tick and the
 * snapshot's own tick, so every client (a reconnected one too) shows the
 * same number. 0 outside warmup.
 */
export function warmupLeft(s: Snapshot | null): number {
  if (!s || s.phase !== "warmup" || s.warmupEnd <= 0) return 0;
  return Math.max(0, Math.ceil((s.warmupEnd - s.tick) / TICK_RATE));
}

/** Seconds as "m:ss". */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds left of a snapshot's time limit (null: no limit, or not running). */
export function secondsLeft(s: Snapshot | null): number | null {
  if (!s || s.timeLimit <= 0 || !clockRuns(s)) return null;
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
  /** Place (see `byPlace`: the final one once ended, else live), and as "1st". */
  place: number;
  placeLabel: string;
  /** Most kills, alone at the top (once ended: the winner, 1st). */
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
  /** By place (`byPlace`). */
  rows: ScoreboardRow[];
  /**
   * Team deathmatch: the two teams, red then blue, each with its score (the
   * team's kills), its rows by place within the team, and whether it won.
   * Null in the other modes.
   */
  teams: ScoreboardTeam[] | null;
  /** Our team (NO_TEAM: none, or watching). */
  youTeam: number;
}

export interface ScoreboardTeam {
  team: number;
  /** "Red" / "Blue". */
  name: string;
  /** Paint index of the team colour. */
  slot: number;
  score: number;
  /** Deaths of the players on it right now. */
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
  const ended = s?.phase === "ended";
  const placed = byPlace(players, ended, s?.mode === "royale");
  const mine = s?.players.get(you);
  const theirs = players.find((p) => p.id !== you);
  const top = placed[0]?.player.kills ?? 0;
  const alone = players.filter((p) => p.kills === top).length === 1;
  // The clock starts when the warmup ends: 0:00 before.
  const running = !!s && clockRuns(s);
  const left = secondsLeft(s);
  const row = ({ player: p, place }: { player: PlayerView & { id: string }; place: number }): ScoreboardRow => ({
    id: p.id,
    name: p.name,
    slot: paintOf(p),
    team: p.team,
    you: p.id === you,
    place,
    placeLabel: ordinal(place),
    // The winner once ended (a broken tie included); while playing, the one most kills.
    leader: ended ? place === 1 : s?.mode !== "royale" && top > 0 && alone && p.kills === top,
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
            deaths: on.reduce((n, p) => n + p.deaths, 0),
            you: youTeam === team,
            won: winningTeam === team,
            // The leader mark is the team's best player here, not the whole room's.
            rows: byPlace(on, ended).map((pl) => ({ ...row(pl), leader: false })),
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
  };
}
