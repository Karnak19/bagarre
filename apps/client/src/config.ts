// The dev switches in the query string, typed once for both the router's
// validateSearch (routes/__root.tsx) and the boot config read before the
// router exists (main.tsx): `?play`, `?map=`, `?lag=`, `?server=`, `?fps=`.

import { SERVER_PORT, type GameMode } from "@bagarre/shared";

export interface DevSearch {
  /**
   * Dev-only: skip the menu and quick-match at once (test scripts, quick
   * testing); `?play=ffa` quick-matches a free for all. One-shot, dropped
   * after use.
   */
  play?: true | "ffa";
  /** Ask for this map (dev servers only; the server ignores it in production). */
  map?: string;
  /** Extra round-trip latency in ms, split half each way. */
  lag?: number;
  /** Another game server, e.g. `http://host:2567`. */
  server?: string;
  /**
   * Dev-only: draw at most this many frames a second (the game itself still
   * runs every animation frame). The e2e suite uses it: its assertions never
   * look at pixels, and many pages drawing at 60 fps starve a CI runner.
   */
  fps?: number;
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined);

/** Parses the raw query object (TanStack Router's, or URLSearchParams'). Unknown keys are dropped. */
export function validateDevSearch(raw: Record<string, unknown>): DevSearch {
  const out: DevSearch = {};
  // `?play` arrives as "" (URLSearchParams) or true / "" (the router's JSON-ish parser).
  if ("play" in raw && raw.play !== false && raw.play !== undefined) out.play = raw.play === "ffa" ? "ffa" : true;
  const map = str(raw.map);
  if (map) out.map = map;
  const lag = Number(raw.lag);
  if (Number.isFinite(lag) && lag > 0) out.lag = lag;
  const server = str(raw.server);
  if (server) out.server = server;
  const fps = Number(raw.fps);
  if (Number.isFinite(fps) && fps > 0) out.fps = fps;
  return out;
}

export interface BootConfig {
  serverUrl: string;
  lagMs: number;
  mapParam: string | null;
  /** `?play` in dev: quick-match this mode at once (null: show the menu). */
  playNow: GameMode | null;
  /** `?fps=` in dev: the most frames drawn per second (0: every animation frame). */
  maxFps: number;
}

/** Read once at boot: the lag, map and server hold for the whole visit (like before the router). */
export function bootConfig(search = location.search): BootConfig {
  const s = validateDevSearch(Object.fromEntries(new URLSearchParams(search)));
  /**
   * `VITE_SERVER_URL` may be a path such as `/colyseus`: in production the
   * client's own web server proxies it to the game server, on the same origin.
   */
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  const serverUrl =
    s.server ??
    (configured?.startsWith("/") ? new URL(configured, location.origin).href.replace(/\/$/, "") : configured) ??
    `${location.protocol}//${location.hostname}:${SERVER_PORT}`;
  return {
    serverUrl,
    lagMs: s.lag ?? 0,
    mapParam: s.map ?? null,
    playNow: import.meta.env.DEV && s.play ? (s.play === "ffa" ? "ffa" : "duel") : null,
    maxFps: import.meta.env.DEV ? (s.fps ?? 0) : 0,
  };
}
