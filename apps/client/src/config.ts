// The dev switches in the query string, typed once for both the router's
// validateSearch (routes/__root.tsx) and the boot config read before the
// router exists (main.tsx): `?play`, `?map=`, `?lag=`, `?server=`, `?fps=`, `?lite`.

import { SERVER_PORT, type GameMode } from "@bagarre/shared";

export interface DevSearch {
  /**
   * Dev-only: skip the menu and quick-match at once (test scripts, quick
   * testing); `?play=ffa` quick-matches a free for all, `?play=tdm` a team
   * deathmatch, `?play=royale` a battle royale. One-shot, dropped after use.
   */
  play?: true | "ffa" | "tdm" | "royale";
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
  /**
   * Dev-only: draw without antialiasing or shadows. The e2e suite uses it:
   * CI renders on the CPU (SwiftShader), where those two cost the most.
   */
  lite?: true;
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined);

/** Parses the raw query object (TanStack Router's, or URLSearchParams'). Unknown keys are dropped. */
export function validateDevSearch(raw: Record<string, unknown>): DevSearch {
  const out: DevSearch = {};
  // `?play` arrives as "" (URLSearchParams) or true / "" (the router's JSON-ish parser).
  if ("play" in raw && raw.play !== false && raw.play !== undefined) out.play = raw.play === "ffa" || raw.play === "tdm" || raw.play === "royale" ? raw.play : true;
  const map = str(raw.map);
  if (map) out.map = map;
  const lag = Number(raw.lag);
  if (Number.isFinite(lag) && lag > 0) out.lag = lag;
  const server = str(raw.server);
  if (server) out.server = server;
  const fps = Number(raw.fps);
  if (Number.isFinite(fps) && fps > 0) out.fps = fps;
  if ("lite" in raw && raw.lite !== false && raw.lite !== undefined) out.lite = true;
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
  /** `?lite` in dev: no antialiasing, no shadows. */
  lite: boolean;
}

/**
 * The game server's base URL, for the rooms (net.ts) and the accounts
 * (auth.ts) alike: `?server=`, else `VITE_SERVER_URL`, else this host on the
 * game server's port. `VITE_SERVER_URL` may be a path such as `/colyseus`: in
 * production the client's own web server proxies it to the game server, on
 * the same origin.
 */
export function resolveServerUrl(search = location.search): string {
  const s = validateDevSearch(Object.fromEntries(new URLSearchParams(search)));
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  return (
    s.server ??
    (configured?.startsWith("/") ? new URL(configured, location.origin).href.replace(/\/$/, "") : configured) ??
    `${location.protocol}//${location.hostname}:${SERVER_PORT}`
  );
}

/** Read once at boot: the lag, map and server hold for the whole visit (like before the router). */
export function bootConfig(search = location.search): BootConfig {
  const s = validateDevSearch(Object.fromEntries(new URLSearchParams(search)));
  return {
    serverUrl: resolveServerUrl(search),
    lagMs: s.lag ?? 0,
    mapParam: s.map ?? null,
    playNow: import.meta.env.DEV && s.play ? (s.play === true ? "duel" : s.play) : null,
    maxFps: import.meta.env.DEV ? (s.fps ?? 0) : 0,
    lite: import.meta.env.DEV && !!s.lite,
  };
}
