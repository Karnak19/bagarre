// The HUD's data: match.ts writes one model per frame with `update()`, the
// React HUD (ui/game/Hud.tsx) reads it. No DOM here. Each HUD widget
// subscribes on its own and picks the few fields it shows, so an idle HUD
// (nothing changing) never re-renders, and the values that do move every
// frame (cooldowns, reload, the debug line) are written straight to the DOM
// by their widget instead of going through React.

import type { PlayerSim, PlayerView } from "@bagarre/shared";
import type { Readable } from "./store.ts";

/** One line of the kill feed: "killer [weapon] victim". */
export interface KillFeedLine {
  /** Unique per death in the room (the key). */
  n: number;
  /** "" for a self-kill (own grenade): the line reads "victim [grenade]". */
  killer: string;
  /** Paint indices (paint.ts): the seat colours, or the team colours in a team deathmatch. */
  killerSlot: number;
  victim: string;
  victimSlot: number;
  /** "Rifle", "Shotgun", "Sniper", "SMG" or "Grenade". */
  weapon: string;
  /** We are the killer / the victim (the line is highlighted). */
  byYou: boolean;
  onYou: boolean;
  /** 0..1: 1 while fresh, fading to 0 over its last second (lines go after KILL_FEED_MS). */
  opacity: number;
}

/** A free-for-all's own HUD: rank, kills, the top 3 and the clock. */
export interface FfaHud {
  /** Our place right now (kills, then deaths; shared places allowed), and as "2nd". */
  rank: number;
  rankLabel: string;
  players: number;
  kills: number;
  killsToWin: number;
  /** The first three, most kills first (we may be among them). */
  top: { id: string; name: string; slot: number; kills: number; you: boolean }[];
  /** Time left as "m:ss" ("" when the match has no time limit or isn't running). */
  timeLeft: string;
  /** Under 30 s left. */
  lowTime: boolean;
  /** Tie at the time limit: the next kill that breaks it wins. */
  suddenDeath: boolean;
}

/** A team deathmatch's own HUD: the team score, the clock, and which team is ours. */
export interface TeamHud {
  /** Our team (TEAM_RED / TEAM_BLUE). */
  you: number;
  red: number;
  blue: number;
  killsToWin: number;
  /** Time left as "m:ss" ("" when not running). */
  timeLeft: string;
  lowTime: boolean;
  suddenDeath: boolean;
}

export interface HudModel {
  status: string;
  me: PlayerView | null;
  /** The duel opponent (null in FFA: see `ffa`). */
  opponent: PlayerView | null;
  /** Free-for-all rank, top 3 and clock; null in a duel. */
  ffa: FfaHud | null;
  /** Team deathmatch score and clock; null in the other modes. */
  team: TeamHud | null;
  /** Recent deaths, oldest first (both modes; the HUD shows it in FFA). */
  feed: KillFeedLine[];
  /** Predicted local state (cooldowns, ammo), fresher than `me`. */
  sim: PlayerSim | null;
  /** Weapon picks are accepted right now (dead, warmup, or between matches). */
  canPick: boolean;
  /** Warmup: whole seconds until the match starts (the loadout panel shows); null outside warmup. */
  warmup: number | null;
  /** The map's name and blurb, for a few seconds at match start. */
  mapCard: { title: string; sub: string; opacity: number } | null;
  debug: string;
  /** Sound muted (M toggles). */
  muted: boolean;
  /** Spectators watching the game (shown small in a corner when there are any). */
  spectators: number;
  /** Flash grenade: the white screen's opacity right now, 0..1 (0: not flashed). */
  flash: number;
}

export class Hud implements Readable<HudModel | null> {
  private model: HudModel | null = null;
  private listeners = new Set<() => void>();

  getState = (): HudModel | null => this.model;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Called by the match once per frame. */
  update(m: HudModel) {
    this.model = m;
    for (const fn of this.listeners) fn();
  }

  /** A new game: nothing to show until its first frame. */
  clear() {
    this.model = null;
    for (const fn of this.listeners) fn();
  }
}
