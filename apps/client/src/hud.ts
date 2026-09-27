// The HUD's data: match.ts writes one model per frame with `update()`, the
// React HUD (ui/game/Hud.tsx) reads it. No DOM here. Each HUD widget
// subscribes on its own and picks the few fields it shows, so an idle HUD
// (nothing changing) never re-renders, and the values that do move every
// frame (cooldowns, reload, the debug line) are written straight to the DOM
// by their widget instead of going through React.

import type { PlayerSim, PlayerView } from "@bagarre/shared";
import type { Readable } from "./store.ts";

export interface HudModel {
  status: string;
  me: PlayerView | null;
  opponent: PlayerView | null;
  /** Predicted local state (cooldowns, ammo), fresher than `me`. */
  sim: PlayerSim | null;
  /** Weapon picks are accepted right now (dead or between matches). */
  canPick: boolean;
  /** The map's name and blurb, for a few seconds at match start. */
  mapCard: { title: string; sub: string; opacity: number } | null;
  debug: string;
  /** Sound muted (M toggles). */
  muted: boolean;
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
