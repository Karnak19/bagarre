// The scoreboard's content: held open with Tab in a match, and part of the
// match result card (drawn by ui/game/Scoreboard.tsx). Everything on it comes
// from the synced room state (the server counts shots, hits, damage and
// measures ping). Pure: no DOM.

import { TICK_RATE, WEAPONS, findMap, ordinal, placements, type GameMode, type PlayerView } from "@bagarre/shared";
import type { Snapshot } from "./net.ts";

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
  slot: number;
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
  return {
    mode: s?.mode ?? "duel",
    mapName: s ? (findMap(s.mapId)?.name ?? "") : "",
    killsToWin: s?.killsToWin ?? 0,
    score: [mine?.kills ?? 0, theirs?.kills ?? 0],
    time: running ? clock(((s.endTick || s.tick) - s.startTick) / TICK_RATE) : "0:00",
    timeLeft: left === null ? "" : clock(Math.ceil(left)),
    suddenDeath: !!s?.suddenDeath,
    rows: placed.map(({ player: p, place }) => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
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
    })),
  };
}
