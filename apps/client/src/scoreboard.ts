// The scoreboard's content: held open with Tab in a match, and part of the
// match result card (drawn by ui/game/Scoreboard.tsx). Everything on it comes
// from the synced room state (the server counts shots, hits, damage and
// measures ping). Pure: no DOM.

import { TICK_RATE, WEAPONS, mapById, type PlayerView } from "@bagarre/shared";
import type { Snapshot } from "./net.ts";

export const COLUMNS = [
  { key: "kills", label: "Kills", short: "K" },
  { key: "deaths", label: "Deaths", short: "D" },
  { key: "damage", label: "Damage", short: "Dmg" },
  { key: "acc", label: "Accuracy", short: "Acc" },
  { key: "weapon", label: "Weapon", short: "Gun" },
  { key: "ping", label: "Ping", short: "Ping" },
] as const;

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface ScoreboardRow {
  name: string;
  slot: number;
  you: boolean;
  /** Most kills, alone at the top. */
  leader: boolean;
  account: boolean;
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
  mapName: string;
  /** Our kills, then theirs. */
  score: [number, number];
  /** Match time, "m:ss". */
  time: string;
  /** Most kills first. */
  rows: ScoreboardRow[];
}

/** The scoreboard's content, from a snapshot (pure: no DOM). `you` is our session id. */
export function scoreboardModel(s: Snapshot | null, you: string): ScoreboardModel {
  const players: [string, PlayerView][] = [];
  s?.players.forEach((p, id) => players.push([id, p]));
  players.sort((a, b) => b[1].kills - a[1].kills || a[1].slot - b[1].slot);
  const mine = s?.players.get(you);
  const theirs = players.find(([id]) => id !== you)?.[1];
  const top = players[0]?.[1].kills ?? 0;
  const alone = players.filter(([, p]) => p.kills === top).length === 1;
  const running = !!s && s.phase !== "waiting";
  return {
    mapName: s ? mapById(s.mapId).name : "",
    score: [mine?.kills ?? 0, theirs?.kills ?? 0],
    time: running ? clock(((s.endTick || s.tick) - s.startTick) / TICK_RATE) : "0:00",
    rows: players.map(([id, p]) => ({
      name: p.name,
      slot: p.slot,
      you: id === you,
      leader: top > 0 && alone && p.kills === top,
      account: p.account,
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
