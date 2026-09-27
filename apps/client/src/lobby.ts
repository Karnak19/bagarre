// The open games list's data: public games to join or watch,
// polled from the game server while someone is watching (the menu is up and
// the tab is visible). No DOM here; menu.ts renders it.

import type { OpenGame } from "@bagarre/shared";
import { fetchOpenGames } from "./net.ts";

/** How often the list refreshes while watched. */
const POLL_MS = 3000;

export interface LobbyState {
  games: OpenGame[];
  /** The last fetch failed (server down or unreachable). */
  error: boolean;
  /** At least one answer (or failure) came back. */
  loaded: boolean;
}

export class Lobby {
  private state: LobbyState = { games: [], error: false, loaded: false };
  private listeners = new Set<(s: LobbyState) => void>();
  private watching = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;

  constructor(private serverUrl: string) {
    document.addEventListener("visibilitychange", () => {
      if (!this.watching) return;
      if (document.visibilityState === "visible") this.poll();
      else this.stopTimer();
    });
  }

  getState(): LobbyState {
    return this.state;
  }

  subscribe(fn: (s: LobbyState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Starts (or stops) polling. */
  watch(on: boolean) {
    if (on === this.watching) return;
    this.watching = on;
    if (on) this.poll();
    else this.stopTimer();
  }

  private set(s: LobbyState) {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
  }

  private poll() {
    this.stopTimer();
    const abort = new AbortController();
    this.abort = abort;
    fetchOpenGames(this.serverUrl, abort.signal)
      .then((games) => this.set({ games, error: false, loaded: true }))
      .catch(() => {
        if (!abort.signal.aborted) this.set({ games: [], error: true, loaded: true });
      })
      .finally(() => {
        if (abort.signal.aborted || !this.watching || document.visibilityState !== "visible") return;
        this.timer = setTimeout(() => this.poll(), POLL_MS);
      });
  }
}
