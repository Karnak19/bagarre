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

/**
 * One line of the battle royale's loot feed: something we just took off the
 * floor, or swapped in with F ("+ Rifle", "+ 2 💥 Frag", "Pistol → Rifle").
 */
export interface LootLine {
  /** Unique in this match (the key). */
  n: number;
  kind: "gun" | "grenade" | "heal" | "shield";
  /** The stable key of what we got ("rifle", "frag", "bandage", "shield"). */
  key: string;
  /** What we got, with how many ("Rifle", "2 💥 Frag", "1 Shield charge"). */
  to: string;
  /** On a swap, what we gave up ("Pistol", "💥 Frag"); "" for a plain pickup. */
  from: string;
  /** 0..1: 1 while fresh, fading to 0 before it goes (LOOT_FEED_MS). */
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

/** The battle royale's own HUD: who is still in, the zone, our gun slots and grenade stack. */
export interface RoyaleHud {
  /** Players still in, and in the match in all. */
  alive: number;
  players: number;
  /** The zone: not there (warmup, the result), waiting to shrink, shrinking, closed. */
  zone: "none" | "waiting" | "shrinking" | "closed";
  /** Until it starts shrinking (waiting) or is closed (shrinking), "m:ss"; "" otherwise. */
  zoneTime: string;
  /** How far it has shrunk, 0..1. */
  shrink: number;
  /** We stand outside it: the arrow shows the way back. */
  outside: boolean;
  /** Screen angle to the zone's centre, degrees clockwise from right (only meaningful when `outside`). */
  arrow: number;
  /** The three gun slots, in order: `weapon` -1 when empty; `hand` is the one in hand. Predicted. */
  slots: { weapon: number; name: string; ammo: number; magazine: number; hand: boolean; reloading: boolean }[];
  /** Grenades left of the type in hand (`me.grenade`). */
  grenades: number;
  /** Healing items (HEAL_ITEMS order: keys 4 and 5) and shield charges carried. Predicted. */
  heals: { key: string; name: string; count: number; max: number }[];
  shields: number;
  /** The heal in progress: its HEAL_ITEMS index (-1: none). Its progress is `sim.kit`'s, written per frame. */
  healing: number;
  /**
   * Why the last heal stopped, while it is fresh (a few seconds): "" when
   * there is nothing to say, else the line to show ("Healed +25", "Heal
   * cancelled: the zone hurts"). `stopKind` is its HEAL_STOP key.
   */
  healNote: string;
  stopKind: string;
  /**
   * What F would do right now (the F prompt, `fTarget`'s pick): open a chest,
   * or swap the gun in hand or the grenade stack held (`from`) for the one
   * on the floor (`to`), as stable keys and display names ("" for a chest).
   * Null when F would do nothing: not playing, out, or nothing in reach F
   * acts on (with a free slot, walking over a gun picks it up). From the
   * predicted position and kit.
   */
  prompt: { kind: "chest" | "gun" | "grenade"; from: string; to: string; fromName: string; toName: string } | null;
  /** What we just picked up or swapped in, oldest first, at most a few lines. From the server's snapshots of our kit. */
  loot: LootLine[];
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
  /** Battle royale: players left, the zone, the gun slots and grenades; null in the other modes. */
  royale: RoyaleHud | null;
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
