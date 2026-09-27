// The scoreboard: held open with Tab in a match, and part of the match
// result card. Everything on it comes from the synced room state (the server
// counts shots, hits, damage and measures ping).

import { KILLS_TO_WIN, TICK_RATE, WEAPONS, mapById, type PlayerView } from "@bagarre/shared";
import type { Snapshot } from "./net.ts";
import { PLAYER_CSS_COLORS } from "./scene.ts";
import { el, setText } from "./ui.ts";

const COLUMNS = [
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

interface Row {
  tr: HTMLTableRowElement;
  dot: HTMLElement;
  name: HTMLElement;
  tag: HTMLElement;
  cells: HTMLTableCellElement[];
}

export class Scoreboard {
  readonly root = el("section", "scoreboard");
  private mapName = el("span", "sb-map");
  private score = el("span", "sb-score");
  private goal = el("span", "sb-goal", `First to ${KILLS_TO_WIN}`);
  private time = el("span", "sb-time");
  private body = el("tbody");
  private rows: Row[] = [];

  constructor(label = "Scoreboard") {
    this.root.setAttribute("aria-label", label);
    const head = el("header", "sb-head");
    const left = el("div", "sb-head-left");
    left.append(this.mapName, this.goal);
    const right = el("div", "sb-head-right");
    this.time.setAttribute("aria-label", "Match time");
    right.append(this.score, this.time);
    head.append(left, right);

    const table = el("table", "sb-table");
    const thead = el("thead");
    const hr = el("tr");
    const th0 = el("th", "sb-player", "Player");
    th0.scope = "col";
    hr.append(th0);
    for (const c of COLUMNS) {
      const th = el("th", `sb-${c.key}`);
      th.scope = "col";
      const long = el("span", "sb-long", c.label);
      const short = el("abbr", "sb-short", c.short);
      short.title = c.label;
      th.append(long, short);
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead, this.body);
    this.root.append(head, table);
  }

  private row(i: number): Row {
    let r = this.rows[i];
    if (r) return r;
    const tr = el("tr");
    const th = el("th", "sb-player");
    th.scope = "row";
    const dot = el("span", "sb-dot");
    const name = el("span", "sb-name");
    const tag = el("span", "sb-tag");
    th.append(dot, name, tag);
    tr.append(th);
    const cells = COLUMNS.map((c) => {
      const td = el("td", `sb-${c.key}`);
      tr.append(td);
      return td;
    });
    r = { tr, dot, name, tag, cells };
    this.rows[i] = r;
    this.body.append(tr);
    return r;
  }

  /** Redraws from the model (see `scoreboardModel`). */
  update(m: ScoreboardModel) {
    setText(this.mapName, m.mapName);
    setText(this.score, `${m.score[0]} – ${m.score[1]}`);
    setText(this.time, m.time);
    m.rows.forEach((p, i) => {
      const r = this.row(i);
      r.tr.hidden = false;
      r.tr.classList.toggle("is-you", p.you);
      r.tr.classList.toggle("is-leader", p.leader);
      r.tr.classList.remove("is-empty");
      r.dot.style.background = PLAYER_CSS_COLORS[p.slot] ?? "#888";
      setText(r.name, p.you ? `${p.name} (you)` : p.name);
      setText(r.tag, p.account ? "Account" : "Guest");
      const values = [String(p.kills), String(p.deaths), String(p.damage), p.accuracy, p.weapon, p.ping];
      r.cells.forEach((td, j) => setText(td, values[j]));
      r.cells[3].title = p.shots > 0 ? `${p.hits} hits / ${p.shots} shots` : "No shots yet";
    });
    for (let i = m.rows.length; i < this.rows.length; i++) this.rows[i].tr.hidden = true;
    // An empty seat while waiting for an opponent.
    if (m.rows.length < 2) {
      const r = this.row(m.rows.length);
      r.tr.hidden = false;
      r.tr.classList.remove("is-you", "is-leader");
      r.tr.classList.add("is-empty");
      r.dot.style.background = "transparent";
      setText(r.name, "Open seat");
      setText(r.tag, "");
      r.cells.forEach((td) => setText(td, ""));
    }
  }
}
